import util from "util";

export function formatDate(ms: number): string {
    const d = new Date(ms);

    return [
            d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0'),
        ].join('-') +
        ' ' +
        [
            String(d.getHours()).padStart(2, '0'),
            String(d.getMinutes()).padStart(2, '0'),
        ].join(':');
}

//const date= formatDate(1770020113711);
//console.log(date)

function safeInspect(value: unknown, depth = 6) {
    // Never throws; useful when output contains weird types.
    try {
        return util.inspect(value, {
            depth,
            colors: true,
            compact: false,
            breakLength: 110,
            maxArrayLength: 200,
        });
    } catch {
        return String(value);
    }
}

export function safeStringify(value: unknown, space = 2) {
    try {
        return JSON.stringify(
            value,
            (key, v) => {
                // Only touch known timestamp fields
                if ((key === "startedAt" || key === "completedAt") && typeof v === "number") {
                    return formatDate(v);
                }
                return v;
            },
            space
        );
    } catch {
        return safeInspect(value, 8);
    }
}

export function printFiles(files: Record<string, string>) {
    const entries = Object.entries(files);

    if (entries.length === 0) {
        console.log("(no files)");
        return;
    }

    for (const [name, content] of entries) {
        console.log(`\n📄 ${name}`);
        console.log("-".repeat(80));
        console.log(content); // IMPORTANT: prints real newlines (not \n)
    }
}

function tryPrettyJson(text: string): string | null {
    const trimmed = text.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;

    try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return null;
    }
}

export function printMessages(messages: { role: string; content: string }[], tail = 8) {
    const slice = messages.slice(-tail);

    if (slice.length === 0) {
        console.log("(no messages)");
        return;
    }

    slice.forEach((m, i) => {
        console.log(`\n[${i + 1}/${slice.length}] ${m.role.toUpperCase()}`);
        console.log("-".repeat(80));

        const prettyJson = tryPrettyJson(m.content);
        if (prettyJson) {
            console.log(prettyJson);
        } else {
            console.log(m.content); // prints real newlines
        }
    });
}