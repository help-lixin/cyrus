import type { QQBot } from "@tencent-connect/qqbot-nodejs";
import type { IAgentRunner, ILogger } from "cyrus-core";
import { createLogger } from "cyrus-core";
import type { QQWebhookEvent } from "cyrus-qq-event-transport";
import type { ChatRepositoryProvider } from "./ChatRepositoryProvider.js";
import type { ChatPlatformAdapter } from "./ChatSessionHandler.js";

/**
 * Sentinel the agent emits when it has decided a QQ message does not warrant
 * a reply. `postReply` recognizes it and stays silent instead of posting.
 */
export const QQ_NO_RESPONSE_SENTINEL = "<<NO_RESPONSE>>";

/**
 * QQ implementation of ChatPlatformAdapter.
 *
 * Contains all QQ-specific logic extracted from EdgeWorker:
 * text extraction, thread keys, system prompts, thread context,
 * and reply posting.
 */
export class QQChatAdapter implements ChatPlatformAdapter<QQWebhookEvent> {
	readonly platformName = "qq" as const;
	private repositoryProvider: ChatRepositoryProvider;
	private repositoryRoutingContext: string;
	private logger: ILogger;
	private bot: QQBot | null = null;

	constructor(
		repositoryProvider: ChatRepositoryProvider,
		logger?: ILogger,
		options?: {
			repositoryRoutingContext?: string;
		},
	) {
		this.repositoryProvider = repositoryProvider;
		this.repositoryRoutingContext =
			options?.repositoryRoutingContext?.trim() || "";
		this.logger = logger ?? createLogger({ component: "QQChatAdapter" });
	}

	/**
	 * Set the QQ bot instance for sending replies.
	 * Called by EdgeWorker after the transport is started.
	 */
	setBot(bot: QQBot | null): void {
		this.bot = bot;
	}

	/**
	 * Get the bot instance, waiting briefly if it hasn't been set yet.
	 * This handles race conditions where postReply is called before setBot.
	 */
	private async getBot(): Promise<QQBot | null> {
		const maxWaitMs = 5000;
		const checkIntervalMs = 100;
		const maxAttempts = maxWaitMs / checkIntervalMs;
		for (let i = 0; i < maxAttempts; i++) {
			if (this.bot) {
				return this.bot;
			}
			await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
		}
		return this.bot;
	}

	extractTaskInstructions(event: QQWebhookEvent): string {
		return event.payload.content || "Ask the user for more context";
	}

	/**
	 * QQ messages are always session-initiating since they require @mention
	 * (enforced by mentionGate middleware in the transport).
	 */
	isSessionInitiatingEvent(_event: QQWebhookEvent): boolean {
		return true;
	}

	getThreadKey(event: QQWebhookEvent): string {
		const { scope, targetId, msgId } = event.payload.replyTarget;
		return `${scope}:${targetId}:${msgId || event.payload.messageId}`;
	}

	getEventId(event: QQWebhookEvent): string {
		return event.eventId;
	}

	buildSystemPrompt(event: QQWebhookEvent): string {
		const repositoryPaths = Array.from(
			new Set(this.repositoryProvider.getRepositoryPaths().filter(Boolean)),
		).sort();
		const repositoryAccessSection =
			repositoryPaths.length > 0
				? `
## Repository Access
- You have read-only access to the following configured repositories:
${repositoryPaths.map((path) => `- ${path}`).join("\n")}

- If you need to inspect source code in one of these repositories, use:
  - Bash(git -C * pull)

- You are explicitly allowed to run git pull with:
  - Bash(git -C * pull)
			`
				: `
## Repository Access
- No repository paths are configured for this chat session.`;

		return `You are participating in a QQ chat.

## Context
- **Chat type**: ${event.payload.replyTarget.scope === "c2c" ? "Private chat (C2C)" : "Group chat"}
- **User**: ${event.payload.senderName || event.payload.senderId || "unknown"}
${event.payload.replyTarget.scope === "group" ? `- **Group**: ${event.payload.replyTarget.targetId}` : ""}

## When to Respond (IMPORTANT)
- You receive messages where the bot is @mentioned (for groups) or directly sent (for C2C).
- Respond to user requests and questions.
- When you have nothing useful to add, output exactly \`${QQ_NO_RESPONSE_SENTINEL}\` and nothing else.

## Instructions
- You are running in a transient workspace, not associated with any code repository
- Be concise in your responses as they will be posted back to QQ
- If the user's request involves code changes, help them plan the work and suggest creating an issue in their project tracker
- You can answer questions, provide analysis, help with planning, and assist with research
${repositoryAccessSection}
${this.repositoryRoutingContext ? `\n\n${this.repositoryRoutingContext}` : ""}

## Self-Knowledge
- If the user asks about your capabilities, features, how you work, what you can do, setup instructions, or anything related to Cyrus documentation, use the \`mcp__cyrus-docs__search_documentation\` tool to look up the answer from the official Cyrus docs.
- Always prefer searching the docs over guessing or relying on your training data for Cyrus-specific questions.

## Orchestration Notes
- If the user asks you to make repo code changes immediately, use these steps:
  - First run \`mcp__linear__get_user\` with \`query: "me"\` to get your Linear identity.
  - Create an Issue in the user's tracker for the requested work (for example using \`mcp__linear__save_issue\`), including enough context and acceptance criteria to execute it. Default the issue status/state to "Backlog". **IMPORTANT: Never set the status to "Triage".**
  - To route the issue to a specific repository, add \`[repo=repo-name]\` to the issue description. To target a specific branch, use \`[repo=repo-name#branch-name]\`. For multiple repos: \`repos=repo1,repo2\`.
  - Assign that Issue to that same user (your own Linear user).
  - That assignment is what immediately kicks off work in your own agent session.
  - Track execution progress by searching \`mcp__cyrus-tools__linear_get_agent_sessions\` for the active session, then opening it with \`mcp__cyrus-tools__linear_get_agent_session\`.
  - To send mid-flight feedback or corrections to a running child session, use \`mcp__cyrus-tools__linear_agent_give_feedback\` with the session ID returned by \`linear_get_agent_sessions\`. This is the ONLY way to directly prompt a running child agent. \`mcp__linear__save_comment\` does NOT trigger or notify the agent in any way — it just writes a comment on the issue, which the running session will not see. Always prefer \`linear_agent_give_feedback\` when the child agent is actively working.

## QQ Message Formatting
Your response will be sent as a QQ message. Keep it concise and clear.
- Use plain text formatting
- Keep responses concise for QQ message limits`;
	}

	async fetchThreadContext(_event: QQWebhookEvent): Promise<string> {
		// QQ doesn't have built-in thread context fetching like Slack
		// Return empty string - context is carried in the message itself
		return "";
	}

	async postReply(event: QQWebhookEvent, runner: IAgentRunner): Promise<void> {
		try {
			// Get the last assistant message from the runner as the summary
			const messages = runner.getMessages();
			const lastAssistantMessage = [...messages]
				.reverse()
				.find((m) => m.type === "assistant");

			let summary = "Task completed.";
			if (
				lastAssistantMessage &&
				lastAssistantMessage.type === "assistant" &&
				"message" in lastAssistantMessage
			) {
				const msg = lastAssistantMessage as {
					message: {
						content: Array<{ type: string; text?: string }>;
					};
				};
				const textBlock = msg.message.content?.find(
					(block) => block.type === "text" && block.text,
				);
				if (textBlock?.text) {
					summary = textBlock.text;
				}
			}

			// The agent emits the no-response sentinel when it judged this message
			// didn't warrant a reply.
			if (summary.includes(QQ_NO_RESPONSE_SENTINEL)) {
				return;
			}

			// Use the bot instance (with retry/wait for bot to be ready)
			const bot = await this.getBot();
			if (!bot) {
				this.logger.warn("Cannot post QQ reply: no bot instance available");
				return;
			}
			await bot.sendText(event.payload.replyTarget, summary);
		} catch (error) {
			this.logger.error(
				"Failed to post QQ reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	async acknowledgeReceipt(_event: QQWebhookEvent): Promise<void> {
		// QQ doesn't have a reaction/emoji acknowledgement system like Slack
		// No-op for now
	}

	async acknowledgeProcessed(_event: QQWebhookEvent): Promise<void> {
		// QQ doesn't have a processed indicator system
		// No-op for now
	}

	async notifyBusy(event: QQWebhookEvent): Promise<void> {
		try {
			// For now, skip busy notification since we need access to the bot
			this.logger.debug(
				`QQ busy notification not implemented for ${event.payload.replyTarget.scope}:${event.payload.replyTarget.targetId}`,
			);
		} catch (_error) {
			this.logger.warn("Failed to send QQ busy notification");
		}
	}
}
