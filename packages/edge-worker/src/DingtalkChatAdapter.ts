/**
 * DingtalkChatAdapter - DingTalk implementation of ChatPlatformAdapter.
 *
 * Contains all DingTalk-specific logic: text extraction, thread keys,
 * system prompts, reply posting, and text-based acknowledgements.
 */

import type { IAgentRunner, ILogger } from "cyrus-core";
import { createLogger } from "cyrus-core";
import {
	DingtalkMessageService,
	type DingtalkWebhookEvent,
	getSessionKey,
	stripMention,
} from "cyrus-dingtalk-event-transport";
import type { ChatRepositoryProvider } from "./ChatRepositoryProvider.js";
import type { ChatPlatformAdapter } from "./ChatSessionHandler.js";

/**
 * DingTalk implementation of ChatPlatformAdapter.
 *
 * DingTalk supports both group chats and 1:1 (single) robot chats. In group
 * chats only @mentions are delivered; in 1:1 chats every message is
 * delivered. Session key is based on the conversation ID (and message ID for
 * group chats, since DingTalk robots have no thread concept).
 */
export class DingtalkChatAdapter
	implements ChatPlatformAdapter<DingtalkWebhookEvent>
{
	readonly platformName = "dingtalk" as const;
	private repositoryProvider: ChatRepositoryProvider;
	private repositoryRoutingContext: string;
	private logger: ILogger;
	private messageService: DingtalkMessageService;

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
		this.logger = logger ?? createLogger({ component: "DingtalkChatAdapter" });
		this.messageService = new DingtalkMessageService();
	}

	extractTaskInstructions(event: DingtalkWebhookEvent): string {
		const text = event.payload.text?.content || "";
		return stripMention(text) || "Hello";
	}

	/**
	 * DingTalk is session-initiating for 1:1 (single) chats and for group
	 * @mentions. Group messages without an @mention are not delivered by
	 * DingTalk, but guard anyway to avoid spawning sessions from ambient
	 * chatter if that ever changes.
	 */
	isSessionInitiatingEvent(event: DingtalkWebhookEvent): boolean {
		// In 1:1 (single) chats, every message starts/continues a session
		if (event.payload.conversationType === "1") {
			return true;
		}
		// In groups, require an @mention to start a session
		return event.payload.isInAtList === true;
	}

	getThreadKey(event: DingtalkWebhookEvent): string {
		return `dingtalk:${getSessionKey(event.payload)}`;
	}

	getEventId(event: DingtalkWebhookEvent): string {
		return event.payload.msgId;
	}

	buildSystemPrompt(_event: DingtalkWebhookEvent): string {
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
`
				: `
## Repository Access
- No repository paths are configured for this chat session.`;

		return `You are participating in a DingTalk conversation.

## Context
- **Conversation ID**: ${_event.payload.conversationId}
- **Chat Type**: ${_event.payload.conversationType === "1" ? "1:1 (Direct)" : "Group"}

## DingTalk Message Guidelines
- Keep responses clear and well-formatted
- DingTalk robot messages are plain text; use markdown formatting sparingly for readability
- In group chats, only respond when explicitly mentioned or when relevant

${repositoryAccessSection}
${this.repositoryRoutingContext ? `\n\n${this.repositoryRoutingContext}` : ""}

## Instructions
- You are running in a transient workspace
- Be helpful, concise, and to the point
- If the user's request involves code changes, help them plan the work and suggest creating an issue in their project tracker (Linear, Jira, or GitHub Issues)

## Orchestration Notes
- If the user asks you to make repo code changes immediately, use these steps:
  - First run \`mcp__linear__get_user\` with \`query: "me"\` to get your Linear identity.
  - Create an Issue in the user's tracker for the requested work (for example using \`mcp__linear__save_issue\`), including enough context and acceptance criteria to execute it. Default the issue status/state to "Backlog". **IMPORTANT: Never set the status to "Triage".**
  - Assign that Issue to that same user (your own Linear user).
  - That assignment is what immediately kicks off work in your own agent session.
`;
	}

	async fetchThreadContext(_event: DingtalkWebhookEvent): Promise<string> {
		// DingTalk Stream mode does not provide a thread history API for robots
		return "";
	}

	async postReply(
		event: DingtalkWebhookEvent,
		runner: IAgentRunner,
	): Promise<void> {
		try {
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
					message: { content: Array<{ type: string; text?: string }> };
				};
				const textBlock = msg.message.content?.find(
					(block) => block.type === "text" && block.text,
				);
				if (textBlock?.text) {
					summary = textBlock.text;
				}
			}

			await this.sendSessionText(event, summary);
		} catch (error) {
			this.logger.error(
				"Failed to post DingTalk reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	async acknowledgeReceipt(event: DingtalkWebhookEvent): Promise<void> {
		try {
			// Send a simple text acknowledgement (DingTalk robots have no
			// reaction/typing-indicator API)
			await this.sendSessionText(event, "收到，正在处理...");
			this.logger.debug(
				`DingTalk receipt acknowledged for message ${event.payload.msgId}`,
			);
		} catch (error) {
			this.logger.warn(
				`Failed to acknowledge DingTalk receipt: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async acknowledgeProcessed(event: DingtalkWebhookEvent): Promise<void> {
		try {
			// Send a confirmation message to indicate processing is complete
			await this.sendSessionText(event, "✅完成");
			this.logger.debug(
				`DingTalk completion acknowledged for message ${event.payload.msgId}`,
			);
		} catch (error) {
			this.logger.warn(
				`Failed to acknowledge DingTalk processed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async notifyBusy(event: DingtalkWebhookEvent): Promise<void> {
		try {
			await this.sendSessionText(
				event,
				"I'm still working on the previous request. I'll respond once I'm done.",
			);
			this.logger.debug(
				`DingTalk busy notification sent to conversation ${event.payload.conversationId}`,
			);
		} catch (error) {
			this.logger.warn(
				`Failed to send DingTalk busy notification: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Send a text message back through the session webhook carried by the
	 * incoming message. The webhook is time-limited; failures are surfaced to
	 * the caller so they can log a warning.
	 */
	private async sendSessionText(
		event: DingtalkWebhookEvent,
		content: string,
	): Promise<void> {
		const sessionWebhook = event.payload.sessionWebhook;
		if (!sessionWebhook) {
			this.logger.warn(
				`No sessionWebhook on DingTalk message ${event.payload.msgId}; cannot send reply`,
			);
			return;
		}
		await this.messageService.sendTextBySessionWebhook({
			sessionWebhook,
			content,
		});
	}
}
