/**
 * Service for posting messages to DingTalk conversations.
 *
 * Two delivery mechanisms are supported:
 * - sessionWebhook: a time-limited webhook URL delivered with each incoming
 *   robot message. Cheapest way to reply — no access token required.
 * - Robot batch send API: proactive messages using an access token obtained
 *   with the app's appKey/appSecret.
 */

/**
 * Parameters for obtaining a DingTalk access token
 */
export interface DingtalkGetAccessTokenParams {
	/** DingTalk app key */
	appKey: string;
	/** DingTalk app secret */
	appSecret: string;
}

/**
 * Parameters for replying via a session webhook
 */
export interface DingtalkSessionWebhookParams {
	/** Session webhook URL from the incoming robot message */
	sessionWebhook: string;
	/** Text content to send */
	content: string;
}

/**
 * Parameters for proactively sending a text message to users (1:1 chats)
 */
export interface DingtalkBatchSendParams {
	/** DingTalk access token */
	accessToken: string;
	/** Robot code of the app sending the message */
	robotCode: string;
	/** DingTalk user IDs (staffIds) to message */
	userIds: string[];
	/** Text content to send */
	content: string;
}

export class DingtalkMessageService {
	private apiBaseUrl: string;

	constructor(apiBaseUrl?: string) {
		this.apiBaseUrl = apiBaseUrl ?? "https://api.dingtalk.com";
	}

	/**
	 * Obtain an app access token using the app's appKey/appSecret.
	 *
	 * @see https://open.dingtalk.com/document/orgapp/obtain-the-access_token-of-an-internal-app
	 */
	async getAccessToken(params: DingtalkGetAccessTokenParams): Promise<string> {
		const { appKey, appSecret } = params;

		const response = await fetch(`${this.apiBaseUrl}/v1.0/oauth2/accessToken`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ appKey, appSecret }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[DingtalkMessageService] Failed to get access token: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		const responseBody = (await response.json()) as {
			accessToken?: string;
			expireIn?: number;
		};
		if (!responseBody.accessToken) {
			throw new Error(
				"[DingtalkMessageService] Access token response missing accessToken",
			);
		}

		return responseBody.accessToken;
	}

	/**
	 * Reply to a robot message via its session webhook.
	 *
	 * The session webhook is delivered with each incoming robot message and is
	 * valid for a limited time window (see `sessionWebhookExpiredTime`).
	 */
	async sendTextBySessionWebhook(
		params: DingtalkSessionWebhookParams,
	): Promise<void> {
		const { sessionWebhook, content } = params;

		const response = await fetch(sessionWebhook, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				msgtype: "text",
				text: { content },
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[DingtalkMessageService] Failed to send session webhook message: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		// DingTalk returns HTTP 200 even for errors — check the response body
		const responseBody = (await response.json()) as {
			errcode?: number;
			errmsg?: string;
		};
		if (responseBody.errcode !== undefined && responseBody.errcode !== 0) {
			throw new Error(
				`[DingtalkMessageService] DingTalk API error: ${responseBody.errmsg ?? "unknown"} (errcode ${responseBody.errcode})`,
			);
		}
	}

	/**
	 * Proactively send a text message to users in 1:1 chats.
	 *
	 * @see https://open.dingtalk.com/document/orgapp/robots-send-one-to-one-chat-messages-in-batches
	 */
	async batchSendTextToUsers(params: DingtalkBatchSendParams): Promise<void> {
		const { accessToken, robotCode, userIds, content } = params;

		const url = `${this.apiBaseUrl}/v1.0/robot/oToMessages/batchSend`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"x-acs-dingtalk-access-token": accessToken,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				robotCode,
				userIds,
				msgKey: "sampleText",
				msgParam: JSON.stringify({ content }),
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[DingtalkMessageService] Failed to batch send message: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}
	}
}
