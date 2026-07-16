/**
 * WeixinChatAdapter - WeChat implementation of ChatPlatformAdapter.
 *
 * Contains all Weixin-specific logic: text extraction, thread keys,
 * system prompts, reply posting, and text-based acknowledgements.
 */

import type { IAgentRunner, ILogger } from "cyrus-core";
import { createLogger } from "cyrus-core";
import type { WeixinParsedMessage } from "cyrus-weixin-event-transport";
import { WeixinMessageService } from "cyrus-weixin-event-transport";
import type { WeixinBot } from "weixin-bot-sdk";
import type { ChatRepositoryProvider } from "./ChatRepositoryProvider.js";
import type { ChatPlatformAdapter } from "./ChatSessionHandler.js";

/**
 * Weixin implementation of ChatPlatformAdapter.
 *
 * Unlike Slack which has threads and channels, Weixin is strictly 1:1.
 * Session key is based on the user's ID.
 */
export class WeixinChatAdapter
	implements ChatPlatformAdapter<WeixinParsedMessage>
{
	readonly platformName = "weixin" as const;
	private repositoryProvider: ChatRepositoryProvider;
	private repositoryRoutingContext: string;
	private logger: ILogger;
	private messageService: WeixinMessageService;
	/** Reference to the WeixinBot instance for sending messages */
	private botRef: WeixinBot | null = null;

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
		this.logger = logger ?? createLogger({ component: "WeixinChatAdapter" });
		this.messageService = new WeixinMessageService();
	}

	/**
	 * Set the WeixinBot reference for sending messages.
	 * Called by EdgeWorker after WeixinEventTransport.login() succeeds.
	 */
	setBot(bot: WeixinBot): void {
		this.botRef = bot;
	}

	extractTaskInstructions(event: WeixinParsedMessage): string {
		return event.text || "Hello";
	}

	/**
	 * Weixin is always session-initiating (every message starts/continues a 1:1 session).
	 * There are no @mentions or explicit invocation in Weixin.
	 */
	isSessionInitiatingEvent(_event: WeixinParsedMessage): boolean {
		return true;
	}

	getThreadKey(event: WeixinParsedMessage): string {
		// Weixin 1:1: thread key is the user's ID
		return `weixin:${event.from}`;
	}

	getEventId(event: WeixinParsedMessage): string {
		return String(event.messageId ?? "");
	}

	buildSystemPrompt(_event: WeixinParsedMessage): string {
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

		return `You are participating in a private WeChat conversation.

## Context
- **User ID**: ${_event.from}

## WeChat Message Guidelines
- WeChat has a 2000 character limit per message
- If your response is longer, it will be split automatically
- Keep responses concise and conversational
- WeChat supports plain text only (no markdown rendering)

${repositoryAccessSection}
${this.repositoryRoutingContext ? `\n\n${this.repositoryRoutingContext}` : ""}

## Instructions
- You are running in a transient workspace
- Be helpful, concise, and conversational
- If the user's request involves code changes, help them plan the work and suggest creating an issue in their project tracker (Linear, Jira, or GitHub Issues)

## Orchestration Notes
- If the user asks you to make repo code changes immediately, use these steps:
  - First run \`mcp__linear__get_user\` with \`query: "me"\` to get your Linear identity.
  - Create an Issue in the user's tracker for the requested work (for example using \`mcp__linear__save_issue\`), including enough context and acceptance criteria to execute it. Default the issue status/state to "Backlog". **IMPORTANT: Never set the status to "Triage".**
  - Assign that Issue to that same user (your own Linear user).
  - That assignment is what immediately kicks off work in your own agent session.
`;
	}

	async fetchThreadContext(_event: WeixinParsedMessage): Promise<string> {
		// Weixin has no thread context API - 1:1 conversations are stateless
		return "";
	}

	async postReply(
		event: WeixinParsedMessage,
		runner: IAgentRunner,
	): Promise<void> {
		if (!this.botRef) {
			this.logger.error("WeixinBot not set - cannot post reply");
			return;
		}

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

			// Send the reply via the message service
			await this.messageService.reply(this.botRef, event, summary);
			// this.logger.info(
			// 	`Weixin reply sent to user ${event.from}: "${summary.slice(0, 50)}..."`,
			// );
		} catch (error) {
			this.logger.error(
				"Failed to post Weixin reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	async acknowledgeReceipt(event: WeixinParsedMessage): Promise<void> {
		if (!this.botRef) {
			this.logger.error("WeixinBot not set - cannot acknowledge receipt");
			return;
		}

		try {
			await this.messageService.sendAcknowledgement(this.botRef, event);
			this.logger.debug(
				`Weixin receipt acknowledged for message ${event.messageId}`,
			);
		} catch (error) {
			this.logger.warn(
				`Failed to acknowledge Weixin receipt: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async acknowledgeProcessed(event: WeixinParsedMessage): Promise<void> {
		if (!this.botRef) {
			this.logger.error("WeixinBot not set - cannot acknowledge processed");
			return;
		}

		try {
			await this.messageService.sendCompletion(this.botRef, event);
			this.logger.debug(
				`Weixin completion acknowledged for message ${event.messageId}`,
			);
		} catch (error) {
			this.logger.warn(
				`Failed to acknowledge Weixin processed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async notifyBusy(event: WeixinParsedMessage): Promise<void> {
		if (!this.botRef) {
			this.logger.error("WeixinBot not set - cannot send busy notification");
			return;
		}

		try {
			await this.messageService.sendBusyNotification(this.botRef, event);
			this.logger.debug(`Weixin busy notification sent to user ${event.from}`);
		} catch (error) {
			this.logger.warn(
				`Failed to send Weixin busy notification: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
