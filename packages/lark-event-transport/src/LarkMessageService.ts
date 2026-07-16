/**
 * Service for posting messages to Lark channels.
 *
 * Uses the Lark SDK to send messages, typically used to reply to
 * @mention webhooks or send responses in threads.
 */

import type { Client } from "@larksuiteoapi/node-sdk";

/**
 * A single message from a Lark thread
 */
export interface LarkThreadMessage {
	/** Message ID */
	messageId: string;
	/** Message content */
	content: string;
	/** Sender ID */
	senderId: string;
	/** Create time (ms timestamp) */
	createTime: number;
}

/**
 * Parameters for sending a message to Lark
 */
export interface LarkSendMessageParams {
	/** Lark API client */
	client: Client;
	/** Chat/Channel ID to send the message to */
	chatId: string;
	/** Message content (text or markdown) */
	content: string;
	/** Message type */
	msgType?: "text" | "post" | "markdown";
}

/**
 * Parameters for getting a message from Lark
 */
export interface LarkGetMessageParams {
	/** Lark API client */
	client: Client;
	/** Message ID */
	messageId: string;
}

export class LarkMessageService {
	/**
	 * Send a message to a Lark channel.
	 *
	 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
	 */
	async sendMessage(params: LarkSendMessageParams): Promise<string> {
		const { client, chatId, content, msgType = "text" } = params;

		try {
			// console.log(`[LarkMessageService] Sending message to chatId=${chatId}, msgType=${msgType}, content="${content}"`);
			const response = await client.im.v1.message.create({
				data: {
					receive_id: chatId,
					msg_type: msgType,
					content: JSON.stringify({ text: content }),
				},
				params: {
					receive_id_type: "chat_id",
				},
			});
			// console.log(`[LarkMessageService] Message sent successfully, messageId=${response.data?.message_id}`);

			return response.data?.message_id ?? "";
		} catch (error) {
			console.error(
				`[LarkMessageService] Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
				error,
			);
			throw new Error(
				`[LarkMessageService] Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Reply to a message in a thread.
	 *
	 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/reply
	 */
	async replyInThread(params: {
		client: Client;
		parentMessageId: string;
		content: string;
		msgType?: "text" | "markdown";
		replyInThread?: boolean;
	}): Promise<string> {
		const {
			client,
			parentMessageId,
			content,
			msgType = "text",
			replyInThread = true,
		} = params;

		try {
			// console.log(`[LarkMessageService] Replying in thread parentMessageId=${parentMessageId}, replyInThread=${replyInThread}, content="${content}"`);
			// Note: reply_in_thread is a query param, not a body param
			const response = await (client.im.v1.message.reply as Function)({
				data: {
					content: JSON.stringify({ text: content }),
					msg_type: msgType,
				},
				params: {
					reply_in_thread: replyInThread,
				},
				path: {
					message_id: parentMessageId,
				},
			});
			// console.log(`[LarkMessageService] Reply sent successfully, messageId=${response.data?.message_id}`);

			return response.data?.message_id ?? "";
		} catch (error) {
			console.error(
				`[LarkMessageService] Failed to reply in thread: ${error instanceof Error ? error.message : String(error)}`,
				error,
			);
			throw new Error(
				`[LarkMessageService] Failed to reply in thread: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Get a message by ID.
	 *
	 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/get
	 */
	async getMessage(
		params: LarkGetMessageParams,
	): Promise<LarkThreadMessage | null> {
		const { client, messageId } = params;

		try {
			const response = await client.im.v1.message.get({
				path: {
					message_id: messageId,
				},
			});

			const message = response as {
				message_id?: string;
				body?: { content?: string };
				sender?: { id?: string };
				create_time?: number;
			};

			return {
				messageId: message.message_id || messageId,
				content: message.body?.content || "",
				senderId: message.sender?.id || "",
				createTime: message.create_time || Date.now(),
			};
		} catch (error) {
			this.logger?.debug(
				`[LarkMessageService] Failed to get message ${messageId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
	}

	private logger?: {
		debug: (msg: string) => void;
	};
}
