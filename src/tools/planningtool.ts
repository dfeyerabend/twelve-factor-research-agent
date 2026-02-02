

class TaskPlanningTool {
    private tasks: Map<string, Task> = new Map();

    constructor() {
    }

    addTask(content: string, dependencies: string[] = []): Task {
        const task: Task = {
            id: crypto.randomUUID(),
            content,
            status: "pending",
            dependencies,
        };

        // Der Task wird durch Zod validert bevor er in das system registriert wird.
        TaskSchema.parse(task);
        this.tasks.set(task.id, task);
        return task;
    }

    // Holt tasks mit status = "pending" -> alle anderen werden ignoriert --> Ein task darf erst laufen wenn alle dependencies abgeschlossen sind
    getNextExecutable(): Task | undefined {
        const pending = [...this.tasks.values()] // get all tasks and their values
            // Schritt 1: geht all tasks mit status "pending"
            // Schritt 2: Wähle einen pending task, dessen dependency schon "completed" ist <-- kann jetzt ausgeführt werden
            .filter(t => t.status === "pending").filter(t => t.dependencies.every(depId => {
                const dep = this.tasks.get(depId);
                return dep?.status === "completed";
            }));

        return pending[0]
    }

    // Wird benutzt um den status den tasks zu ändern wird vom Agent benutzt weil sonst getNextExecutable() immer den gleichen task ausführen würde wenn der status nicht auf "completed" geändert wird
    setStatus(taskId: string, status: TaskStatus, result?: unknown, error?: string): void {
        const task = this.tasks.get(taskId);

        if (!task) throw new Error(`Task ${taskId} not found`);

        // set task status to status
        const now = Date.now()
        task.status = status;

        // IF statements to filter the task
        if (status === "in_progress") task.startedAt = now;
        if (status === "completed" || status === "blocked") task.completedAt = now;
        // Here was an error: status !== undefined was always true, so task.result was always assigned <- However, its better to only assign a result if result !== undefined, this ensures that an actual result is present
        if (result !== undefined) task.result = result;
        if (error) task.error = error;
    }
}