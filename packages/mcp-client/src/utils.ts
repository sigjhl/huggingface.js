import { inspect } from "util";

export function debug(...args: unknown[]): void {
	if (process.env.DEBUG) {
		console.debug(inspect(args, { depth: Infinity, colors: true }));
	}
}

export const ANSI = {
	BLUE: "\x1b[34m",
	GRAY: "\x1b[90m",
	GREEN: "\x1b[32m",
	RED: "\x1b[31m",
	YELLOW: "\x1b[33m", // Added
	CYAN: "\x1b[36m",   // Added
	RESET: "\x1b[0m",
};