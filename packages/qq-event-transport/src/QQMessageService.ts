/**
 * QQ Message Service
 *
 * Provides methods for sending messages back to QQ users/groups.
 *
 * @module qq-event-transport/QQMessageService
 */

import type {
	MessageResponse,
	QQBot,
	ReplyTarget,
} from "@tencent-connect/qqbot-nodejs";

/**
 * Service for sending messages via QQ Bot
 */
export class QQMessageService {
	constructor(private readonly bot: QQBot) {}

	/**
	 * Send a text message to a QQ user or group.
	 */
	async sendText(
		target: ReplyTarget,
		content: string,
	): Promise<MessageResponse> {
		return this.bot.sendText(target, content);
	}

	/**
	 * Send a markdown message to a QQ user or group.
	 */
	async sendMarkdown(
		target: ReplyTarget,
		content: string,
	): Promise<MessageResponse> {
		return this.bot.sendMarkdown(target, content);
	}

	/**
	 * Send a typing indicator to a QQ user (C2C only).
	 */
	async sendTyping(
		target: ReplyTarget,
		durationSec?: number,
	): Promise<{ refIdx?: string }> {
		return this.bot.sendTyping(target, durationSec);
	}
}
