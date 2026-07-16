/**
 * LarkChatAdapter - Lark/Feishu implementation of ChatPlatformAdapter.
 *
 * Contains all Lark-specific logic: text extraction, thread keys,
 * system prompts, reply posting, and text-based acknowledgements.
 */

import { Client } from "@larksuiteoapi/node-sdk";
import type { IAgentRunner, ILogger } from "cyrus-core";
import { createLogger } from "cyrus-core";
import {
	LarkMessageService,
	type LarkWebhookEvent,
	stripMention,
} from "cyrus-lark-event-transport";
import type { ChatRepositoryProvider } from "./ChatRepositoryProvider.js";
import type { ChatPlatformAdapter } from "./ChatSessionHandler.js";

/**
 * Lark implementation of ChatPlatformAdapter.
 *
 * Lark supports both group chats and 1:1 (p2p) messages. Session key is based
 * on the chat ID and thread/message ID.
 */
export class LarkChatAdapter implements ChatPlatformAdapter<LarkWebhookEvent> {
	readonly platformName = "lark" as const;
	private repositoryProvider: ChatRepositoryProvider;
	private repositoryRoutingContext: string;
	private logger: ILogger;
	private messageService: LarkMessageService;
	private client: Client;

	constructor(
		repositoryProvider: ChatRepositoryProvider,
		logger?: ILogger,
		options?: {
			repositoryRoutingContext?: string;
			/** Lark app ID for API client */
			appId?: string;
			/** Lark app secret for API client */
			appSecret?: string;
		},
	) {
		this.repositoryProvider = repositoryProvider;
		this.repositoryRoutingContext =
			options?.repositoryRoutingContext?.trim() || "";
		this.logger = logger ?? createLogger({ component: "LarkChatAdapter" });
		this.messageService = new LarkMessageService();
		this.client = new Client({
			appId: options?.appId || "",
			appSecret: options?.appSecret || "",
		});
	}

	extractTaskInstructions(event: LarkWebhookEvent): string {
		const text = event.payload.content || "";
		return stripMention(text) || "Hello";
	}

	/**
	 * Lark is session-initiating for @mention events and for first messages in p2p chats.
	 * For group chats without @mention, it returns false to avoid spawning sessions
	 * from ambient chatter.
	 */
	isSessionInitiatingEvent(event: LarkWebhookEvent): boolean {
		// Always start a session if the bot is mentioned
		if (event.payload.mentionedBot) {
			return true;
		}
		// In p2p (1:1) chats, every message starts/continues a session
		if (event.payload.chatType === "p2p") {
			return true;
		}
		// In groups, require an @mention to start a session
		return false;
	}

	getThreadKey(event: LarkWebhookEvent): string {
		// P2P chats: all messages belong to the same session (no threadId, use chatId only)
		if (event.payload.chatType === "p2p") {
			return `lark:${event.payload.chatId}`;
		}
		// Group chats: use threadId or messageId to distinguish topics/threads
		const threadId = event.payload.threadId || event.payload.messageId;
		return `lark:${event.payload.chatId}:${threadId}`;
	}

	getEventId(event: LarkWebhookEvent): string {
		return event.payload.messageId;
	}

	buildSystemPrompt(_event: LarkWebhookEvent): string {
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

		return `You are participating in a Lark/Feishu conversation.

## Context
- **Chat ID**: ${_event.payload.chatId}
- **Chat Type**: ${_event.payload.chatType === "p2p" ? "1:1 (Direct)" : "Group"}

## Lark Message Guidelines
- Keep responses clear and well-formatted
- Lark supports text and markdown message types
- Use markdown formatting sparingly for readability
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

	async fetchThreadContext(_event: LarkWebhookEvent): Promise<string> {
		// Lark WebSocket mode does not provide a thread history API
		return "";
	}

	async postReply(
		event: LarkWebhookEvent,
		runner: IAgentRunner,
	): Promise<void> {
		try {
			// console.log(`[LarkChatAdapter] postReply: chatId=${event.payload.chatId}, messageId=${event.payload.messageId}`);
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

			// Reply in thread if we have a parent message
			const parentId =
				event.payload.replyToMessageId ||
				event.payload.rootId ||
				event.payload.messageId;

			await this.messageService.replyInThread({
				client: this.client,
				parentMessageId: parentId,
				content: summary,
				msgType: "text",
				replyInThread: true,
			});

			// this.logger.info(
			// 	`Lark reply sent to chat ${event.payload.chatId}: "${summary.slice(0, 50)}..."`,
			// );
		} catch (error) {
			this.logger.error(
				"Failed to post Lark reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	async acknowledgeReceipt(event: LarkWebhookEvent): Promise<void> {
		try {
			// console.log(`[LarkChatAdapter] acknowledgeReceipt: sending "..." to chatId=${event.payload.chatId}`);
			// Send a simple "..." typing indicator to acknowledge receipt
			await this.messageService.sendMessage({
				client: this.client,
				chatId: event.payload.chatId,
				content: "收到，正在处理...",
				msgType: "text",
			});
			this.logger.debug(
				`Lark receipt acknowledged for message ${event.payload.messageId}`,
			);
		} catch (error) {
			console.error(
				`[LarkChatAdapter] acknowledgeReceipt failed: ${error instanceof Error ? error.message : String(error)}`,
				error,
			);
			this.logger.warn(
				`Failed to acknowledge Lark receipt: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async acknowledgeProcessed(event: LarkWebhookEvent): Promise<void> {
		try {
			// console.log(`[LarkChatAdapter] acknowledgeProcessed: sending "✅" to chatId=${event.payload.chatId}`);
			// Send a confirmation message to indicate processing is complete
			await this.messageService.sendMessage({
				client: this.client,
				chatId: event.payload.chatId,
				content: "✅完成",
				msgType: "text",
			});
			this.logger.debug(
				`Lark completion acknowledged for message ${event.payload.messageId}`,
			);
		} catch (error) {
			console.error(
				`[LarkChatAdapter] acknowledgeProcessed failed: ${error instanceof Error ? error.message : String(error)}`,
				error,
			);
			this.logger.warn(
				`Failed to acknowledge Lark processed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async notifyBusy(event: LarkWebhookEvent): Promise<void> {
		try {
			// console.log(`[LarkChatAdapter] notifyBusy: sending busy message to chatId=${event.payload.chatId}`);
			await this.messageService.sendMessage({
				client: this.client,
				chatId: event.payload.chatId,
				content:
					"I'm still working on the previous request. I'll respond once I'm done.",
				msgType: "text",
			});
			this.logger.debug(
				`Lark busy notification sent to chat ${event.payload.chatId}`,
			);
		} catch (error) {
			console.error(
				`[LarkChatAdapter] notifyBusy failed: ${error instanceof Error ? error.message : String(error)}`,
				error,
			);
			this.logger.warn(
				`Failed to send Lark busy notification: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
