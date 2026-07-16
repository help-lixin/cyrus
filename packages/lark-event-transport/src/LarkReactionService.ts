/**
 * Service for adding and removing reactions on Lark messages.
 *
 * Uses the Lark SDK to manage emoji reactions,
 * typically used to acknowledge receipt of @mention webhooks and to
 * signal that a message has been processed.
 */

import type { Client } from "@larksuiteoapi/node-sdk";

/**
 * Parameters for adding a reaction on a Lark message
 */
export interface LarkAddReactionParams {
	/** Lark API client */
	client: Client;
	/** Message ID to react to */
	messageId: string;
	/** Emoji reaction type (e.g., "OK", "Thumbs_up") */
	reactionType: string;
}

/**
 * Parameters for removing a reaction on a Lark message
 */
export interface LarkRemoveReactionParams {
	/** Lark API client */
	client: Client;
	/** Message ID */
	messageId: string;
	/** Reaction ID to remove */
	reactionId: string;
}

/**
 * Lark reaction service for managing emoji reactions
 */
export class LarkReactionService {
	/**
	 * Add a reaction to a Lark message.
	 *
	 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-reaction/create
	 */
	async addReaction(params: LarkAddReactionParams): Promise<void> {
		const { client, messageId, reactionType } = params;

		try {
			await client.im.v1.messageReaction.create({
				path: {
					message_id: messageId,
				},
				data: {
					reaction_type: {
						emoji_type: reactionType,
					},
				},
			});
		} catch (error) {
			// "already_reacted" is not an error worth surfacing
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (errorMsg.includes("already_reacted")) {
				return;
			}
			throw new Error(
				`[LarkReactionService] Failed to add reaction: ${errorMsg}`,
			);
		}
	}

	/**
	 * Remove a reaction from a Lark message.
	 *
	 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-reaction/delete
	 */
	async removeReaction(params: LarkRemoveReactionParams): Promise<void> {
		const { client, messageId, reactionId } = params;

		try {
			await client.im.v1.messageReaction.delete({
				path: {
					message_id: messageId,
					reaction_id: reactionId,
				},
			});
		} catch (error) {
			// "no_reaction" means it was never added or already removed — fine
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (errorMsg.includes("no_reaction")) {
				return;
			}
			throw new Error(
				`[LarkReactionService] Failed to remove reaction: ${errorMsg}`,
			);
		}
	}
}
