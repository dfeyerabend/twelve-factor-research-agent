import { z } from "zod";
import crypto from "crypto";
import {createLLM, LLMConfig} from "./llm"

// ============================================
// TYPES
// ============================================

// ---- Task Schemata ----

const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "blocked", "cancelled", "crashed"]);

const TaskSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1), // Short description of task for logging (e.g. write_summary)
    content: z.string().min(1),
    status: TaskStatusSchema,
    dependencies: z.array(z.string().uuid()).default([]),
    result: z.unknown().optional(), // Wenn das LLM etwas komisches wiedergibt (Error), dann crasht es nicht, der unerwartete result wird gecached und die response wird trotzdem zurück gegeben
    error: z.string().optional(),
    errorCode: z.string().optional(), // optional: maschinenlesbarer Fehlercode (z.B. "invalid_json")
    startedAt: z.number().optional(),
    completedAt: z.number().optional()
});

type Task = z.infer<typeof TaskSchema>; // This creates the TYPE Task (not just a ZodSchema)
type TaskStatus = z.infer<typeof TaskStatusSchema>; // This creates the TYPE TaskStatus (not just a ZodSchema)


// General TaskResult Schema to be used with the SupervisorAgent
const TaskResultSchema = z.object({
    summary: z.string().min(1),
    output: z.unknown().optional(), // Could be text or a file
    next: z.enum(["done", "blocked"]).default("done"),
    error: z.string().optional(),
});
type TaskResult = z.infer<typeof TaskResultSchema>;

// ---- SupervisorAgent Schemata ----

type Message = {
    role: "user" | "assistant" | "system";
    content: string;
};

type AgentState = {
    messages: Message[];
    tasks: Task[];
    files: Record<string, string>;
    step: number;
    status: "running" | "completed";
};

// ---- SubAgent Schemata ----

const SubAgentTypeSchema = z.enum([
    "researcher", // find and extract info
    "writer", // produce text content
])

export type SubAgentType = z.infer<typeof SubAgentTypeSchema>;

interface SubAgentConfig {
    type: SubAgentType;
    systemPrompt: string;
    tools: string[]; // Hier müssen später echte Tool-Objekte hin
    llmConfig: LLMConfig;
}

export interface SubAgentResult {
    agentType: SubAgentType;
    taskId: string; // The Subagent task gets its own task ID
    summary: string; // QUARANTINE: Max 500 tokens!
    confidence: number; // 0-1
    metadata: {
        tokensUsed: number;
        executionTimeMs: number;
        toolsUsed: string[];
    };
}

interface SubAgentTask {
    id: string;
    agentType: SubAgentType,
    instruction: string;
    context: string;
    status: "pending" | "running" | "completed" | "failed";
    result?: SubAgentResult;
    error?: string;
    startedAt?: number;
    completedAt?: number;
}

// ============================================
// TOOLS
// ============================================



// ============================================
// REDUCER
// ============================================

type AgentAction =
    | { type: "SET_TASKS"; payload: Task[] } // <- get array of tasks
    | { type: "ADD_MESSAGE"; payload: Message } // fügt eine Chat-Nachricht hinzu
    | {
        type: "UPDATE_TASK"; // Aktualisiert Task-Felder (Status/Result/Error/Timestamps)
        payload: {
            taskId: string;
            patch: Partial<Pick<Task, "status" | "result" | "error" | "startedAt" | "completedAt">>;
        };
    }
    // | { type: "RESEARCH"; payload: string } not used for now
    | { type: "WRITE_FILE"; payload: { name: string; content: string } } // speichert Datei im State
    | { type: "INCREMENT_STEP" } // zählt einen Schritt hoch
    | { type: "SET_STATUS"; payload: "running" | "completed" };


// Aktualisiert AgentState rein funktional: (state, action) -> newState
function agentReducer(state: AgentState, action: AgentAction): AgentState {
    switch (action.type) {
        case "SET_TASKS":
            return {...state, tasks: action.payload}; // übernimmt Snapshot

        case "ADD_MESSAGE":
            return {...state, messages: [...state.messages, action.payload]};

        case "UPDATE_TASK": { // Aktualisiert nur den aktuellen Task (anhand taskID)
            const updatedTasks = state.tasks.map((t) => {
                if (t.id !== action.payload.taskId) return t;
                return {...t, ...action.payload.patch};
            })

            return {...state, tasks: updatedTasks};
        }

        case "WRITE_FILE":
            return {...state, files: {
                        ...state.files,
                        [action.payload.name]: action.payload.content
                }
            };

        case "INCREMENT_STEP":
            return { ...state, step: state.step + 1 };

        case "SET_STATUS":
            return { ...state, status: action.payload };

        default:
            return state;
    }
}


// ============================================
// TASK PLANNER (minimal, ohne LLM)
// ============================================

// Erstellt eine simple To-do-Liste (ohne LLM), damit der Flow erstmal läuft.
function createPlan(userRequest: string): Task[] {
    const researchId = crypto.randomUUID(); // erzeugt UUID für Task 1
    const writeId = crypto.randomUUID();

    return [
        {
            id: researchId,
            name: "research_online",
            content: `Research: ${userRequest}`, // Konvention: beginnt mit "Research:"
            status: "pending",
            dependencies: [],
        },
        {
            id: writeId,
            name: "write_summary",
            content: "Write: summary to file", // Konvention: beginnt mit "Write:"
            status: "pending",
            dependencies: [researchId]
        },
    ];
}

// Abwandlung aus plannerTool-Skript: Prüft ob alle Dependencies einer Task completed sind
function areDependenciesDone(task: Task, tasks: Task[]): boolean {
    console.log(`Checking Dependencies for task ${task.name}`)
    for (const depId of task.dependencies) { // läuft jede Dependency-ID des Tasks durch (nicht den Task selber) <- Tasks ohne dependency werden sofort ausgeführt
        const depTask = tasks.find((t) => t.id === depId); // sucht die Task ID in "tasks", die genau diese ID hat (isoliert den task)

        if (!depTask) { // wenn keine Task mit dieser ID existiert
            console.log(`Listed Dependency for task: ${task.name} was not found in list of tasks`);
            return false; // dep fehlt -> blockiert: Task kann NICHT starten, weil Dependency fehlt
        }
        if (depTask.status !== "completed") { // wenn die Dependency-Task existiert, aber nicht fertig ist
            console.log(`Dependency ${depId} for task: ${task.content} is not yet complete`);
            return false; // dep noch nicht fertig
        }
    }
    return true;
}

// Gibt die nächste ausführbare Task zurück (pending + deps erfüllt)
function findNextRunnableTask(tasks: Task[]): Task | null {
    console.log("Searching for next executable Task 🔍")
    for (const task of tasks) {
        if (task.status !== "pending") continue;
        if (!areDependenciesDone(task, tasks)) continue;
        console.log(`✅ All Dependencies fulfilled, task: ${task.name} ready to be executed`)
        return task;
    }
    const pendingCount = tasks.filter(t => t.status === "pending").length;
    console.log(`No executable tasks found. Pending tasks remaining: ${pendingCount}`);
    return null;
}


// ============================================
// SUPERVISOR EXECUTOR
// ============================================

class SupervisorExecutor {
    private llm; // hält die ChatOpenAI Instanz für Supervisor-Reasoning

    constructor(llmConf: LLMConfig) {
        this.llm = createLLM(llmConf); // erzeugt ChatOpenAI über LLM Factory
    }

    // Führt eine Task aus und liefert das rohe LLM-Text zurück (keine JSON.parse / Zod-Validierung hier)
    async executeTask(task: Task, state: AgentState): Promise<{ rawText: string }> {
        // Examples for now
        const jsonExampleForResearch = {
            summary: "3 bullet points summarizing the 3 studies.",
            output: {
                studies: [
                    { title: "Study A", year: 2021, keyFinding: "..." },
                    { title: "Study B", year: 2022, keyFinding: "..." },
                    { title: "Study C", year: 2023, keyFinding: "..." }
                ]
            },
            next: "done"
        };

        const jsonExampleForWrite = {
            summary: "Wrote the summary file.",
            output: { fileName: "summary.md", content: "# Summary\n\n..." },
            next: "done"
        };

        const systemPrompt = [
            "You are a helpful agent that executes exactly one task.",
            "Tools are NOT available.",
            "",
            "Output format requirements (strict):",
            "1) Return ONLY a single JSON object.",
            "2) Do NOT wrap in ``` code fences.",
            "3) Do NOT add any extra keys outside the schema.",
            "4) Types must match exactly (summary must be a string).",
            "",
            "Schema (informal):",
            "{ summary: string, output?: any, next?: \"done\"|\"blocked\", error?: string }",
            "",
            "If the task is Research: simulate you searched the web and found 3 studies; put the useful details into `output`.",
            "If the task is Write: `output` MUST be exactly { fileName: string, content: string }.",
            "",
            "Example JSON for Research task:",
            JSON.stringify(jsonExampleForResearch, null, 2),
            "",
            "Example JSON for Write task:",
            JSON.stringify(jsonExampleForWrite, null, 2),
        ].join("\n");

        const userPrompt = [
            `CURRENT STEP: ${state.step}`,
            `TASK: ${task.content}`,
            "CONTEXT (last messages):",
            state.messages
                .slice(-6)
                .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
                .join("\n"),
            "",
        ].join("\n");

        const response = await this.llm.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ]);

        const rawText = String(response.content ?? "").trim(); // extrahiert Text aus LLM response

        // Return only rawText; parsing/validation happens in the caller so we always have access to the raw output
        return { rawText };
    }
}

// ============================================
// MAIN AGENT LOGIC (Orchestrator)
// ============================================

// Runner speichert keinen AgentState <- Reducer logik
class AgentRunner {
    private supervisor: SupervisorExecutor; // führt LLM-Calls für Tasks aus

    // Baut nur die Abhängigkeiten (LLM etc.), aber speichert keinen AgentState -> Reducer logic.
    constructor (llmConf: LLMConfig) {
        this.supervisor = new SupervisorExecutor(llmConf);
    }

    // Erstellt einen initialen AgentState
    initState(userRequest: string): AgentState {
        let state: AgentState = {
            messages: [{ role: "user", content: userRequest }],
            tasks: [],
            files: {},
            step: 0,
            status: "running",
        };

        // Planning Logic
        const plan = createPlan(userRequest); // nutzt deinen Planner
        state = agentReducer(state, { type: "SET_TASKS", payload: plan }); // Plan speichern
        state = agentReducer(state, {
            type: "ADD_MESSAGE",
            payload: { role: "assistant", content: "Plan created." },
        }); // Log-Nachricht
        state = agentReducer(state, { type: "INCREMENT_STEP" }); // Schritt hochzählen

        return state;
    }

    // Führt genau eine ausführbare Task aus ODER finalisiert den Run, wenn nichts mehr runnable ist.

    async step(state: AgentState): Promise<AgentState> {
        console.log(`\n[STEP ${state.step}] Searching next runnable task...`); // Debug: zeigt aktuellen Step

        // ============================================
        // GET NEXT EXECUTABLE TASK
        // ============================================
        const nextTask = findNextRunnableTask(state.tasks); // Sucht die nächste ausführbare Task

        // Fall A: Keine Task ist ausführbar -> Run wird abgeschlossen
        if (!nextTask) {
            console.log(`[STEP ${state.step}] No runnable tasks -> completing run.`);

            let state_after_complete = agentReducer(state, { // erstellt neuen State über reducer
                type: "SET_STATUS",
                payload: "completed",
            }); // setzt Agentstatus auf completed

            state_after_complete = agentReducer(state_after_complete, { // fügt Abschlussnachricht hinzu
                type: "ADD_MESSAGE",
                payload: { role: "assistant", content: "Run completed." },
            }); // schreibt Abschlussmessage in messages

            return state_after_complete; // gibt finalisierten State zurück
        }

        console.log(`[STEP ${state.step}] Running task: ${nextTask.name} (${nextTask.id.slice(0, 8)})`); // Debug: welche Task wird jetzt ausgeführt

        // ============================================
        // RUN TASK WITH LLM
        // ============================================
        // 1) Task STARTEN: Status in_progress setzen + startedAt setzen
        const state_task_started = agentReducer(state, {
            type: "UPDATE_TASK",
            payload: {
                taskId: nextTask.id,
                patch: { status: "in_progress", startedAt: Date.now() }, // markiert Startzeit
            },
        }); // Task wird als laufend markiert (wichtig vor LLM call)

        console.log(`[STEP ${state_task_started.step}] Task in_progress -> calling Supervisor LLM...`); // Debug: wir gehen jetzt in den LLM call

        // 2) LLM CALL: Task ausführen
        let task_result: TaskResult | null = null; // erstelle empty result container
        let rawModelOutput = ""; // erstelle model output

        try {
            const response =  await this.supervisor.executeTask(nextTask, state_task_started); // LLM führt Task aus
            rawModelOutput = response.rawText;

            // Store the model output in history (so it becomes part of the context for the next step)
            const state_with_model_output = agentReducer(state_task_started, {
                type: "ADD_MESSAGE",
                payload: { role: "assistant", content: rawModelOutput },
            });


            // Now parse and validate using Zod; errors will be caught by the catch block below
            const parsed = JSON.parse(rawModelOutput); // may throw SyntaxError
            task_result = TaskResultSchema.parse(parsed); // may throw ZodError


            // Use the state that includes the stored raw model output going forward
            // 3) RESULT LOGGEN: Ergebnis in messages hinzufügen (damit es im Kontext bleibt)
            const state_after_result_logged = agentReducer(state_with_model_output, { // schreibt eine Assistant-Message in den Verlauf
                type: "ADD_MESSAGE",
                payload: {
                    role: "assistant",
                    content: `Task done: ${nextTask.content}\nSummary: ${task_result.summary}`,
                },
            });

            // 4) SIDE EFFECT: Wenn Write-Task, dann Datei im State speichern
            let state_after_side_effects = state_after_result_logged; // default: keine Änderung, falls keine Write-Task

            // Check if task is for writing and if an output was provided
            const isWriteTask = nextTask.name === "write_summary";
            const hasObjectOutput = task_result.output !== null && typeof task_result.output === "object";
            if (isWriteTask && hasObjectOutput) { // nur bei Write-Tasks + output
                console.log(
                    `[STEP ${state_after_result_logged.step}] Write task detected -> saving file to state.files`
                ); // Debug: wir schreiben eine Datei

                const maybeFile = task_result.output as { fileName?: unknown; content?: unknown }; // output ist unknown -> wir prüfen vorsichtig

                const fileName =
                    typeof maybeFile.fileName === "string" ? maybeFile.fileName : "output.md"; // fallback Dateiname
                const fileContent =
                    typeof maybeFile.content === "string" ? maybeFile.content : task_result.summary; // fallback Content

                state_after_side_effects = agentReducer(state_after_result_logged, { // schreibt Datei in state.files
                    type: "WRITE_FILE",
                    payload: { name: fileName, content: fileContent }, // Key = filename, Value = content
                }); // speichert Datei im AgentState
            }

            // 5) TASK FINALISIEREN: Status completed/blocked setzen + result speichern
            const finalStatus: TaskStatus = task_result.next === "done" ? "completed" : "blocked"; // mapt TaskResult.next auf TaskStatus

            console.log(
                `[STEP ${state_after_side_effects.step}] Finalizing task -> status: ${finalStatus}`
            ); // Debug: Task wird beendet

            const state_after_task_finalized = agentReducer(state_after_side_effects, { // finalisiert Task im State
                type: "UPDATE_TASK",
                payload: {
                    taskId: nextTask.id,
                    patch: {
                        status: finalStatus, // completed oder blocked
                        result: task_result, // TaskResult komplett speichern (hilft später beim Debug)
                        error: task_result.error, // optionaler Fehlertext aus TaskResult
                        completedAt: Date.now(), // Endzeitpunkt setzen
                    },
                },
            }); // Task ist jetzt "fertig" im State

            // 6) STEP HOCHZÄHLEN: zählt einen Agent-Schritt hoch (für Limits/Debug/Checkpoints)
            const state_after_step_incremented = agentReducer( // erhöht den step Counter
                state_after_task_finalized,
                { type: "INCREMENT_STEP" }
            ); // step++

            console.log(`[STEP ${state_after_step_incremented.step}] Step complete.`); // Debug: zeigt dass step() durch ist

            return state_after_step_incremented; // gibt den aktualisierten State zurück
        } catch (error) {
            const error_message = error instanceof Error ? error.message : String(error); // Macht Fehlertext zuverlässig zu string
            const isJsonSyntaxError = error instanceof SyntaxError; // true wenn JSON.parse kaputt war
            const isZodError = error instanceof z.ZodError; // true wenn JSON zwar parsebar war, aber Schema falsch

            // Error type for logging
            const errorType: "Unknown" | "JsonSyntaxError" | "TaskSchemaZodError" = isJsonSyntaxError ? "JsonSyntaxError" : isZodError ? "TaskSchemaZodError" : "Unknown";

            console.log(`[STEP ${state_task_started.step}] LLM ERROR caught: Error type: ${errorType}\nError message: ${error_message.slice(0, 100)}`);

            // Get the last assistant message
            const error_msg = rawModelOutput
                .replace(/\s+/g, " ")
                .slice(0, 800);


            let formatHint = "";
            // Defines suitable format hints
            if (isJsonSyntaxError) { // unterscheidet "format error" von "hard error"
                formatHint = "You did not provide valid JSON. The output MUST be in the format: { summary: \"your summary\" }"; // definierter Ziel-Output (kurz)
            } else if (isZodError) {
                formatHint =
                    "Your JSON parsed, but it did not match the required schema.\n" +
                    "Fix the fields/types and try again.\n" +
                    "Follow the same JSON shape as the examples in the system prompt.";
            } else {
                formatHint = "An unknown error occurred. Return ONLY valid JSON matching the required schema.";
            }

            const compactedErrorInstruction = [ // baut kompakte Instruktion zusammen
                "Your last attempt failed. Please try again.",
                formatHint, // Formatvorgabe
                "Your last attempt (truncated):", // Preview-Ankündigung
                error_msg, // gekürzte letzte assistant message (falls vorhanden)
            ].join("\n"); // macht einen String daraus

            let state_after_error_logged = agentReducer(state_task_started, { // schreibt die kompakte Instruktion in messages
                type: "ADD_MESSAGE", // action: message hinzufügen
                payload: {role: "assistant", content: compactedErrorInstruction}, // deine gewünschte Form
            });

            state_after_error_logged = agentReducer(state_after_error_logged, { // setzt Task wieder auf pending, damit sie im nächsten Step erneut runnable sein kann
                type: "UPDATE_TASK", // action: task patchen
                payload: {
                    taskId: nextTask.id,
                    patch: {
                        status: "pending",
                        error: `${errorType}: ${error_message.slice(0, 400)}`,
                        startedAt: undefined,
                    },
                },
            });

            const state_after_step_incremented = agentReducer( // step++ damit "ein Versuch == ein Step" gilt
                state_after_error_logged,
                {type: "INCREMENT_STEP"}
            );

            console.log(`[STEP ${state_after_step_incremented.step}] Compacted error stored, task reset to pending.`); // Debug: zeigt was passiert ist
            console.log(`[STEP ${state_after_step_incremented.step}] Step complete.`); // Debug: Ende des Steps
            return state_after_step_incremented; // gibt state zurück, run loop geht weiter
        }
    }

    // Führt step() so lange aus, bis state.status completed ist ODER kein Fortschritt mehr möglich.
    async run(initialState: AgentState, maxSteps = 50): Promise<AgentState> {
        let state = initialState; // lokaler State im run()-Scope (Runner speichert ihn nicht dauerhaft)
        console.log(`🚀 Starte Agent Loop\nUser request: ${state.messages[0].content}`)

        while (state.status !== "completed" && state.step < maxSteps) {
            const beforeStep = state.step; // merkt sich den Step vor dem step()-Call
            console.log(`\n➡️  Run Loop | step = ${state.step} | status = ${state.status}`); // High-level Fortschritt
            state = await this.step(state); // führt genau eine Task oder finalisiert aus

            console.log(`⬅️  Step finished | newStep = ${state.step} | status = ${state.status}`); // Ergebnis des step()-Calls

            // Safety: Wenn step() den Step nicht erhöht und auch nicht completed setzt, wären wir in einer Endlosschleife
            if (state.status !== "completed" && state.step === beforeStep) {
                console.warn(`⛔ Safety stop triggered at step=${state.step}. No progress detected.`);
                // Blockt den Run kontrolliert (ohne neue Types einzuführen)
                state = agentReducer(state, {
                    type: "ADD_MESSAGE",
                    payload: {
                        role: "assistant",
                        content:
                            "Safety stop: step() made no progress. Check blocked tasks or planner logic.",
                    },
                }); // Message hinzufügen
                state = agentReducer(state, { type: "SET_STATUS", payload: "completed" }); // beendet den Run sauber
                break;
            }
        }

        console.log(`🏁 Agent finished | finalStep=${state.step} | status=${state.status}`);
        return state;
    }
}

// ============================================
// SubAgent Logic
// ============================================

class subAgentExecutor {
    private llm;

    constructor(llmConf: LLMConfig) {
    this.llm = createLLM(llmConf)
    }
}

class subAgentManager {
    // TODO: später SubAgent-Registry + delegate-Logik implementieren
}

// ============================================
// RUN DEMO
// ============================================

// CURRENTLY Minimal-Flow: initState -> run -> Logs.
async function runDemo() {
    const userRequest =
        "Find 3 key points about the 12-factor agents idea and write a short summary file.";

    const runner = new AgentRunner({
        model: "gpt-4o-mini",
        temperature: 0.7,
    });

    const initialState = runner.initState(userRequest); // erstellt Start-State inkl. Plan
    const finalState = await runner.run(initialState, 20); // führt Tasks aus (maxSteps als Safety)

    console.log("=== FINAL STATUS ===");
    console.log(finalState.status);

    console.log("=== FINAL TASKS ===");
    console.log(finalState.tasks);

    console.log("=== FILES ===");
    console.log(finalState.files);

    console.log("=== LAST MESSAGES ===");
    console.log(finalState.messages.slice(-8));
}

// Run the demo
runDemo().catch((err) => {
    console.error("Demo crashed:", err);
});

