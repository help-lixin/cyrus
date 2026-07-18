import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DingtalkEventTransport } from "../src/DingtalkEventTransport.js";
import type { DingtalkEventTransportConfig } from "../src/types.js";
import {
	testGroupMessage,
	testGroupMessageNoMention,
	testSingleMessage,
} from "./fixtures.js";

/**
 * Captured robot message callbacks registered on the mock DWClient.
 */
const callbackListeners = new Map<string, (downstream: unknown) => void>();

const mockClientInstances: Array<{
	config: { clientId: string; clientSecret: string };
	connected: boolean;
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	registerCallbackListener: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("dingtalk-stream-sdk-nodejs", () => {
	const TOPIC_ROBOT = "/v1.0/im/bot/messages/get";

	class MockDWClient {
		connected = false;
		config: { clientId: string; clientSecret: string };

		constructor(config: { clientId: string; clientSecret: string }) {
			this.config = config;
			mockClientInstances.push(
				this as unknown as (typeof mockClientInstances)[number],
			);
		}

		registerCallbackListener = vi.fn(
			(topic: string, callback: (downstream: unknown) => void) => {
				callbackListeners.set(topic, callback);
				return this;
			},
		);

		connect = vi.fn(async () => {
			this.connected = true;
		});

		disconnect = vi.fn(() => {
			this.connected = false;
		});
	}

	return {
		DWClient: MockDWClient,
		TOPIC_ROBOT,
		TOPIC_CARD: "/v1.0/card/instances/callback",
		EventAck: { SUCCESS: "SUCCESS", LATER: "LATER" },
	};
});

const { DingtalkEventTransport: Transport } = await import(
	"../src/DingtalkEventTransport.js"
);

/**
 * Creates a mock logger
 */
function createMockLogger() {
	return {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

/**
 * Creates a mock DingtalkEventTransportConfig
 */
function createMockConfig(
	overrides: Partial<DingtalkEventTransportConfig> = {},
): DingtalkEventTransportConfig {
	return {
		appKey: "test_app_key",
		appSecret: "test_app_secret",
		autoReconnect: true,
		...overrides,
	};
}

/**
 * Build a downstream frame like the SDK delivers for a robot message.
 */
function buildDownstream(data: unknown) {
	return {
		specVersion: "1.0",
		type: "CALLBACK",
		headers: {
			appId: "app_1",
			connectionId: "conn_1",
			contentType: "application/json",
			messageId: "frame_1",
			time: String(Date.now()),
			topic: "/v1.0/im/bot/messages/get",
		},
		data: typeof data === "string" ? data : JSON.stringify(data),
	};
}

describe("DingtalkEventTransport", () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let transport: DingtalkEventTransport;

	beforeEach(() => {
		vi.clearAllMocks();
		callbackListeners.clear();
		mockClientInstances.length = 0;
		mockLogger = createMockLogger();
		transport = new Transport(createMockConfig(), mockLogger);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("should create a new instance", () => {
			expect(transport).toBeInstanceOf(Transport);
		});

		it("should create with default logger if not provided", () => {
			const t = new Transport(createMockConfig());
			expect(t).toBeInstanceOf(Transport);
		});
	});

	describe("setTranslationContext", () => {
		it("should set translation context", () => {
			transport.setTranslationContext({
				organizationId: "test_org",
			});

			// No error means success
			expect(true).toBe(true);
		});

		it("should merge with existing context", () => {
			transport.setTranslationContext({
				organizationId: "test_org",
			});

			transport.setTranslationContext({
				metadata: { key: "value" },
			});

			// No error means success
			expect(true).toBe(true);
		});
	});

	describe("register", () => {
		it("should create a DWClient with appKey/appSecret as clientId/clientSecret", async () => {
			await transport.register();

			expect(mockClientInstances).toHaveLength(1);
			expect(mockClientInstances[0]!.config).toEqual({
				clientId: "test_app_key",
				clientSecret: "test_app_secret",
				keepAlive: true,
			});
		});

		it("should register a callback listener for the robot topic and connect", async () => {
			await transport.register();

			expect(callbackListeners.has("/v1.0/im/bot/messages/get")).toBe(true);
			expect(mockClientInstances[0]!.connect).toHaveBeenCalledOnce();
		});

		it("should emit connected after the WebSocket connects", async () => {
			const onConnected = vi.fn();
			transport.on("connected", onConnected);

			await transport.register();

			expect(onConnected).toHaveBeenCalledOnce();
		});
	});

	describe("getConnectionStatus", () => {
		it("should return idle when not connected", () => {
			expect(transport.getConnectionStatus()).toBe("idle");
		});

		it("should return connected after register", async () => {
			await transport.register();
			expect(transport.getConnectionStatus()).toBe("connected");
		});
	});

	describe("message handling", () => {
		async function registeredTransport(
			config: Partial<DingtalkEventTransportConfig> = {},
		) {
			const t = new Transport(createMockConfig(config), mockLogger);
			await t.register();
			const callback = callbackListeners.get("/v1.0/im/bot/messages/get")!;
			return { t, callback };
		}

		it("should emit event and message for a group @mention", async () => {
			const { t, callback } = await registeredTransport();
			const onEvent = vi.fn();
			const onMessage = vi.fn();
			t.on("event", onEvent);
			t.on("message", onMessage);

			callback(buildDownstream(testGroupMessage));

			expect(onEvent).toHaveBeenCalledOnce();
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: "robot.message.receive",
					eventId: testGroupMessage.msgId,
				}),
			);
			expect(onMessage).toHaveBeenCalledOnce();
			expect(onMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					source: "dingtalk",
					action: "session_start",
				}),
			);
		});

		it("should emit event and message for a 1:1 (single) chat message", async () => {
			const { t, callback } = await registeredTransport();
			const onEvent = vi.fn();
			const onMessage = vi.fn();
			t.on("event", onEvent);
			t.on("message", onMessage);

			callback(buildDownstream(testSingleMessage));

			expect(onEvent).toHaveBeenCalledOnce();
			expect(onMessage).toHaveBeenCalledOnce();
		});

		it("should de-duplicate repeated deliveries of the same message", async () => {
			const { t, callback } = await registeredTransport();
			const onEvent = vi.fn();
			t.on("event", onEvent);

			callback(buildDownstream(testGroupMessage));
			callback(buildDownstream(testGroupMessage));

			expect(onEvent).toHaveBeenCalledOnce();
		});

		it("should ignore non-text messages", async () => {
			const { t, callback } = await registeredTransport();
			const onEvent = vi.fn();
			t.on("event", onEvent);

			callback(
				buildDownstream({
					...testGroupMessage,
					msgId: "msg_picture",
					msgtype: "picture",
				}),
			);

			expect(onEvent).not.toHaveBeenCalled();
		});

		it("should ignore messages with unparseable data", async () => {
			const { t, callback } = await registeredTransport();
			const onEvent = vi.fn();
			t.on("event", onEvent);

			callback(buildDownstream("not json at all"));

			expect(onEvent).not.toHaveBeenCalled();
		});

		it("should ignore group messages without @mention when thread-following is disabled", async () => {
			const { t, callback } = await registeredTransport({
				isThreadFollowingEnabled: () => false,
			});
			const onEvent = vi.fn();
			t.on("event", onEvent);

			callback(buildDownstream(testGroupMessageNoMention));

			expect(onEvent).not.toHaveBeenCalled();
		});

		it("should still process 1:1 messages when thread-following is disabled", async () => {
			const { t, callback } = await registeredTransport({
				isThreadFollowingEnabled: () => false,
			});
			const onEvent = vi.fn();
			t.on("event", onEvent);

			callback(buildDownstream(testSingleMessage));

			expect(onEvent).toHaveBeenCalledOnce();
		});
	});

	describe("close", () => {
		it("should disconnect the client and emit disconnected", async () => {
			const onDisconnected = vi.fn();
			transport.on("disconnected", onDisconnected);

			await transport.register();
			transport.close();

			expect(mockClientInstances[0]!.disconnect).toHaveBeenCalledOnce();
			expect(onDisconnected).toHaveBeenCalledOnce();
			expect(transport.getConnectionStatus()).toBe("idle");
		});

		it("should be a no-op when never registered", () => {
			const onDisconnected = vi.fn();
			transport.on("disconnected", onDisconnected);

			transport.close();

			expect(onDisconnected).not.toHaveBeenCalled();
		});
	});
});
