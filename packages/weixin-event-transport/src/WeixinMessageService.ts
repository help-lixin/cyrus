/**
 * WeixinMessageService - Service for sending messages back to Weixin users.
 *
 * Wraps bot.reply(), bot.sendText(), etc. and provides convenience methods
 * for acknowledgement and completion messages.
 */

import type { ParsedMessage, WeixinBot } from "weixin-bot-sdk";
import { markdownToPlainText } from "weixin-bot-sdk";
import type { WeixinParsedMessage } from "./types.js";

/**
 * Service for sending messages back to Weixin users.
 */
export class WeixinMessageService {
	/**
	 * Send an acknowledgement message to the user.
	 * Called immediately when a message is received.
	 *
	 * @param bot - The WeixinBot instance
	 * @param parsed - The parsed message to reply to
	 */
	async sendAcknowledgement(
		bot: WeixinBot,
		parsed: WeixinParsedMessage,
	): Promise<void> {
		try {
			// Convert ParsedMessage to the format expected by bot.reply()
			const msgForReply = this.toReplyMessage(parsed);
			await bot.reply(msgForReply, "收到，正在处理...");
		} catch (error) {
			// Log but don't throw - ack is best-effort
			console.error("Failed to send Weixin acknowledgement:", error);
		}
	}

	/**
	 * Send a completion message to the user.
	 * Called after agent processing is done.
	 *
	 * @param bot - The WeixinBot instance
	 * @param parsed - The parsed message to reply to
	 */
	async sendCompletion(
		bot: WeixinBot,
		parsed: WeixinParsedMessage,
	): Promise<void> {
		try {
			const msgForReply = this.toReplyMessage(parsed);
			await bot.reply(msgForReply, "✅ 完成");
			// await bot.reply(msgForReply, "");
		} catch (error) {
			console.error("Failed to send Weixin completion:", error);
		}
	}

	/**
	 * Send a plain text reply to a user.
	 *
	 * @param bot - The WeixinBot instance
	 * @param toUserId - The user ID to send to
	 * @param text - The text to send
	 * @param contextToken - Optional context token (if not provided, uses cached)
	 */
	async sendText(
		bot: WeixinBot,
		toUserId: string,
		text: string,
		contextToken?: string,
	): Promise<void> {
		// Convert markdown to plain text for WeChat compatibility
		const plainText = markdownToPlainText(text);
		await bot.sendText(toUserId, plainText, contextToken);
	}

	/**
	 * Send a reply to a received message using the cached context token.
	 *
	 * @param bot - The WeixinBot instance
	 * @param parsed - The parsed message to reply to
	 * @param text - The text to send
	 */
	async reply(
		bot: WeixinBot,
		parsed: WeixinParsedMessage,
		text: string,
	): Promise<void> {
		const msgForReply = this.toReplyMessage(parsed);
		// Convert markdown to plain text
		const plainText = markdownToPlainText(text);
		await bot.reply(msgForReply, plainText);
	}

	/**
	 * Send a busy notification when agent is still processing.
	 *
	 * @param bot - The WeixinBot instance
	 * @param parsed - The parsed message to reply to
	 */
	async sendBusyNotification(
		bot: WeixinBot,
		parsed: WeixinParsedMessage,
	): Promise<void> {
		try {
			const msgForReply = this.toReplyMessage(parsed);
			await bot.reply(msgForReply, "我还在处理之前的请求，完成后会回复您。");
		} catch (error) {
			console.error("Failed to send Weixin busy notification:", error);
		}
	}

	/**
	 * Send a typing indicator.
	 *
	 * @param bot - The WeixinBot instance
	 * @param userId - The user ID to show typing for
	 * @param contextToken - Optional context token
	 */
	async sendTyping(
		bot: WeixinBot,
		userId: string,
		contextToken?: string,
	): Promise<void> {
		try {
			await bot.sendTyping(userId, contextToken);
		} catch (error) {
			// Best-effort
			console.error("Failed to send Weixin typing:", error);
		}
	}

	/**
	 * Convert WeixinParsedMessage to the ParsedMessage format expected by bot.reply().
	 */
	private toReplyMessage(parsed: WeixinParsedMessage): ParsedMessage {
		return {
			messageId: parsed.messageId,
			from: parsed.from,
			to: parsed.to,
			timestamp: parsed.timestamp,
			contextToken: parsed.contextToken,
			text: parsed.text,
			textWithQuote: parsed.textWithQuote,
			type: parsed.type,
			image: parsed.image,
			voice: parsed.voice,
			file: parsed.file,
			video: parsed.video,
			quotedMessage: parsed.quotedMessage,
			raw: parsed.raw,
		};
	}
}
