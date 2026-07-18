import { createServer } from "node:net";

let serverInstance: OpenCodeServerManager | null = null;

export interface ServerInfo {
	url: string;
	close: () => void;
}

export class OpenCodeServerManager {
	private server: ServerInfo | null = null;
	private activeSessions = 0;
	private idleTimeout: ReturnType<typeof setTimeout> | null = null;
	private readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;
	private readonly BASE_CONFIG = {
		permission: { "*": "ask", question: "deny" } as Record<string, string>,
		logLevel: "ERROR" as const,
	};

	static getInstance(): OpenCodeServerManager {
		if (!serverInstance) {
			serverInstance = new OpenCodeServerManager();
		}
		return serverInstance;
	}

	private async findFreePort(): Promise<number> {
		return new Promise((resolve, reject) => {
			const server = createServer();
			server.listen(0, () => {
				const address = server.address();
				if (address && typeof address === "object" && address.port) {
					server.close(() => resolve(address.port));
				} else {
					server.close(() => reject(new Error("Failed to get port")));
				}
			});
			server.on("error", reject);
		});
	}

	async acquire(): Promise<{ url: string }> {
		if (process.env.CYRUS_OPENCODE_SERVER_URL) {
			console.log(
				`[OpenCodeServerManager] Using external server: ${process.env.CYRUS_OPENCODE_SERVER_URL}`,
			);
			this.activeSessions++;
			this.cancelIdleTimeout();
			return { url: process.env.CYRUS_OPENCODE_SERVER_URL };
		}

		if (this.server) {
			const healthUrl = `${this.server.url}/health`;
			try {
				const response = await fetch(healthUrl, {
					method: "GET",
					headers: { "Content-Type": "application/json" },
				});
				if (response.ok) {
					this.activeSessions++;
					this.cancelIdleTimeout();
					return { url: this.server.url };
				}
			} catch {
				console.log("[OpenCodeServerManager] Server unhealthy, respawning...");
				await this.spawnServer();
				this.activeSessions++;
				this.cancelIdleTimeout();
				return { url: this.server!.url };
			}
		}

		await this.spawnServer();
		this.activeSessions++;
		this.cancelIdleTimeout();
		return { url: this.server!.url };
	}

	private async spawnServer(): Promise<void> {
		if (this.server) {
			try {
				this.server.close();
			} catch {}
			this.server = null;
		}

		const port = await this.findFreePort();
		const { createOpencodeServer } = await import("@opencode-ai/sdk");

		console.log(
			`[OpenCodeServerManager] Spawning opencode serve on 127.0.0.1:${port}`,
		);

		this.server = await createOpencodeServer({
			hostname: "127.0.0.1",
			port,
			timeout: 10000,
			config: this.BASE_CONFIG,
		});

		console.log(`[OpenCodeServerManager] Server started at ${this.server.url}`);
	}

	release(): void {
		this.activeSessions = Math.max(0, this.activeSessions - 1);
		if (this.activeSessions === 0) {
			this.scheduleIdleTimeout();
		}
	}

	private scheduleIdleTimeout(): void {
		this.cancelIdleTimeout();
		this.idleTimeout = setTimeout(async () => {
			if (this.activeSessions === 0 && this.server) {
				console.log(
					"[OpenCodeServerManager] Idle timeout reached, closing server...",
				);
				await this.shutdown();
			}
		}, this.IDLE_TIMEOUT_MS);
	}

	private cancelIdleTimeout(): void {
		if (this.idleTimeout) {
			clearTimeout(this.idleTimeout);
			this.idleTimeout = null;
		}
	}

	async shutdown(): Promise<void> {
		this.cancelIdleTimeout();
		if (this.server) {
			try {
				this.server.close();
				console.log("[OpenCodeServerManager] Server shutdown complete");
			} catch (error) {
				console.error(`[OpenCodeServerManager] Error closing server: ${error}`);
			}
			this.server = null;
		}
		this.activeSessions = 0;
	}

	getActiveSessionCount(): number {
		return this.activeSessions;
	}
}

export function getOpenCodeServerManager(): OpenCodeServerManager {
	return OpenCodeServerManager.getInstance();
}
