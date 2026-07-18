import { describe, expect, it } from "vitest";
import { OpenCodeMessageFormatter } from "../src/formatter.js";

describe("OpenCodeMessageFormatter", () => {
	const formatter = new OpenCodeMessageFormatter();

	describe("formatTodoWriteParameter", () => {
		it("formats TodoWrite todos as markdown checklist", () => {
			const formatted = formatter.formatTodoWriteParameter(
				JSON.stringify({
					todos: [
						{ content: "implement runner", status: "in_progress" },
						{ content: "run tests", status: "pending" },
						{ content: "ship", status: "completed" },
					],
				}),
			);
			expect(formatted).toContain("- [ ] implement runner (in progress)");
			expect(formatted).toContain("- [ ] run tests");
			expect(formatted).toContain("- [x] ship");
		});

		it("formats todo_status_completed status", () => {
			const formatted = formatter.formatTodoWriteParameter(
				JSON.stringify({
					todos: [{ content: "Done task", status: "todo_status_completed" }],
				}),
			);
			expect(formatted).toContain("- [x] Done task");
		});

		it("formats todo_status_in_progress status", () => {
			const formatted = formatter.formatTodoWriteParameter(
				JSON.stringify({
					todos: [
						{ content: "Working on it", status: "todo_status_in_progress" },
					],
				}),
			);
			expect(formatted).toContain("- [ ] Working on it (in progress)");
		});

		it("uses description as fallback for content", () => {
			const formatted = formatter.formatTodoWriteParameter(
				JSON.stringify({
					todos: [{ description: "fallback content", status: "pending" }],
				}),
			);
			expect(formatted).toContain("fallback content");
		});

		it("returns original JSON on parse error", () => {
			const original = "not valid json";
			expect(formatter.formatTodoWriteParameter(original)).toBe(original);
		});
	});

	describe("formatTaskParameter", () => {
		it("returns string input as-is", () => {
			expect(
				formatter.formatTaskParameter("TaskCreate", "build something"),
			).toBe("build something");
		});

		it('formats TaskList as "List all tasks"', () => {
			expect(formatter.formatTaskParameter("TaskList", {})).toBe(
				"List all tasks",
			);
		});

		it("formats TaskCreate with subject", () => {
			expect(
				formatter.formatTaskParameter("TaskCreate", { subject: "new feature" }),
			).toBe("new feature");
		});

		it("formats TaskUpdate with taskId and subject", () => {
			expect(
				formatter.formatTaskParameter("TaskUpdate", {
					taskId: "123",
					subject: "fix bug",
					status: "completed",
				}),
			).toBe("Task #123 completed: fix bug");
		});

		it("formats TaskUpdate with just taskId", () => {
			expect(
				formatter.formatTaskParameter("TaskUpdate", {
					taskId: "456",
					status: "closed",
				}),
			).toBe("Task #456 closed");
		});

		it("formats TaskGet with taskId and subject", () => {
			expect(
				formatter.formatTaskParameter("TaskGet", {
					taskId: "789",
					subject: "lookup",
				}),
			).toBe("Task #789: lookup");
		});

		it("formats TaskGet with just taskId", () => {
			expect(formatter.formatTaskParameter("TaskGet", { taskId: "999" })).toBe(
				"Task #999",
			);
		});

		it("stringifies unknown input", () => {
			expect(
				formatter.formatTaskParameter("Unknown", { unknown: "data" }),
			).toBe('{"unknown":"data"}');
		});
	});

	describe("formatToolParameter", () => {
		it("returns string input as-is", () => {
			expect(formatter.formatToolParameter("Bash", "ls -la")).toBe("ls -la");
		});

		it("uses command when present", () => {
			expect(
				formatter.formatToolParameter("Bash", { command: "pnpm test" }),
			).toBe("pnpm test");
		});

		it("uses file_path (opencode format)", () => {
			expect(
				formatter.formatToolParameter("Read", { file_path: "src/index.ts" }),
			).toBe("src/index.ts");
		});

		it("uses path when present", () => {
			expect(
				formatter.formatToolParameter("Glob", { path: "src/**/*.ts" }),
			).toBe("src/**/*.ts");
		});

		it("uses url for WebFetch", () => {
			expect(
				formatter.formatToolParameter("WebFetch", {
					url: "https://example.com",
				}),
			).toBe("https://example.com");
		});

		it("uses pattern for Grep", () => {
			expect(formatter.formatToolParameter("Grep", { pattern: "TODO" })).toBe(
				"TODO",
			);
		});

		it("uses pattern with tool name for non-grep tools", () => {
			expect(
				formatter.formatToolParameter("Search", { pattern: "query" }),
			).toBe("query (Search)");
		});

		it("falls back to JSON stringification", () => {
			expect(formatter.formatToolParameter("Unknown", { key: "value" })).toBe(
				'{"key":"value"}',
			);
		});
	});

	describe("formatToolActionName", () => {
		it("returns tool name with description when present", () => {
			expect(
				formatter.formatToolActionName(
					"Read",
					{ description: "main entry" },
					false,
				),
			).toBe("Read (main entry)");
		});

		it("returns just tool name when no description", () => {
			expect(formatter.formatToolActionName("Read", {}, false)).toBe("Read");
		});

		it("trims description whitespace", () => {
			expect(
				formatter.formatToolActionName(
					"Edit",
					{ description: "  fix typo  " },
					false,
				),
			).toBe("Edit (fix typo)");
		});
	});

	describe("formatToolResult", () => {
		it("returns result as-is when not an error", () => {
			expect(
				formatter.formatToolResult("Read", {}, "file contents", false),
			).toBe("file contents");
		});

		it("wraps error result in code fence", () => {
			const result = formatter.formatToolResult(
				"Bash",
				{},
				"command failed",
				true,
			);
			expect(result).toContain("```");
			expect(result).toContain("command failed");
		});

		it("truncates long results", () => {
			const longResult = "a".repeat(5000);
			const result = formatter.formatToolResult("Read", {}, longResult, false);
			expect(result).toContain("[truncated]");
		});

		it("returns 'No output' for empty result", () => {
			expect(formatter.formatToolResult("Read", {}, "", false)).toBe(
				"No output",
			);
		});
	});
});
