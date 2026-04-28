import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsResultSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { McpServerConfig } from "../config/types.js";

/**
 * McpManager — Orchestrates connections to external MCP servers.
 */
export class McpManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();

  /**
   * Connect to all configured MCP servers in parallel.
   */
  async connectAll(configs: Record<string, McpServerConfig>): Promise<void> {
    const entries = Object.entries(configs);
    await Promise.allSettled(
      entries.map(async ([name, config]) => {
        try {
          await this.connect(name, config);
        } catch (error) {
          process.stderr.write(`[MCP] Failed to connect to server "${name}": ${error}\n`);
        }
      })
    );
  }

  /**
   * Connect to a single MCP server.
   */
  async connect(name: string, config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: {
        ...process.env,
        ...(config.env ?? {}),
      } as any,
    });

    const client = new Client(
      { name: "llmrix-devtool", version: "0.0.5" },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.set(name, client);
    this.transports.set(name, transport);
    
    process.stderr.write(`[MCP] Connected to server: ${name}\n`);
  }

  /**
   * List all tools from all servers in parallel and convert them to LangChain format.
   */
  async getAllTools(): Promise<DynamicStructuredTool[]> {
    const serverEntries = Array.from(this.clients.entries());
    
    const results = await Promise.allSettled(
      serverEntries.map(async ([serverName, client]) => {
        const response = await client.request({ method: "tools/list" }, ListToolsResultSchema);
        return response.tools.map((tool) => this.wrapTool(serverName, tool));
      })
    );

    const allTools: DynamicStructuredTool[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        allTools.push(...result.value);
      } else {
        process.stderr.write(`[MCP] Failed to list tools: ${result.reason}\n`);
      }
    }

    return allTools;
  }

  private wrapTool(serverName: string, tool: any): DynamicStructuredTool {
    // Standardize tool name: alphanumeric and underscores only
    const sanitizedServerName = serverName.replace(/[^a-zA-Z0-9_]/g, "_");
    const sanitizedToolName = tool.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const toolName = `${sanitizedServerName}_${sanitizedToolName}`;
    
    return new DynamicStructuredTool({
      name: toolName,
      description: tool.description || `MCP tool: ${tool.name}`,
      schema: this.jsonSchemaToZod(tool.inputSchema),
      func: async (args) => {
        const client = this.clients.get(serverName);
        if (!client) throw new Error(`MCP server "${serverName}" not connected`);

        const result = await client.request(
          {
            method: "tools/call",
            params: { name: tool.name, arguments: args },
          },
          CallToolResultSchema
        );

        if (result.isError) {
          const errorMsg = result.content
            .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
            .join("\n");
          throw new Error(`MCP Tool Error: ${errorMsg}`);
        }

        return result.content
          .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
          .join("\n");
      },
    });
  }

  /**
   * Recursive JSON Schema to Zod converter.
   */
  private jsonSchemaToZod(schema: any): z.ZodObject<any> {
    if (!schema || schema.type !== "object") return z.object({});
    return this.buildZodObject(schema);
  }

  private buildZodObject(schema: any): z.ZodObject<any> {
    const shape: Record<string, z.ZodTypeAny> = {};
    const properties = schema.properties || {};
    const required = schema.required || [];

    for (const [key, prop] of Object.entries(properties) as [string, any][]) {
      let zodType: z.ZodTypeAny;

      if (prop.type === "object") {
        zodType = this.buildZodObject(prop);
      } else if (prop.type === "array") {
        if (prop.items && prop.items.type === "object") {
          zodType = z.array(this.buildZodObject(prop.items));
        } else {
          zodType = z.array(this.mapPrimitive(prop.items?.type));
        }
      } else {
        zodType = this.mapPrimitive(prop.type);
      }

      // Safety check for empty enums
      if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
        zodType = z.enum(prop.enum as [string, ...string[]]);
      }
      
      if (prop.description) zodType = zodType.describe(prop.description);
      if (!required.includes(key)) zodType = zodType.optional();

      shape[key] = zodType;
    }

    return z.object(shape);
  }

  private mapPrimitive(type: string): z.ZodTypeAny {
    switch (type) {
      case "string": return z.string();
      case "number": return z.number();
      case "integer": return z.number().int();
      case "boolean": return z.boolean();
      default: return z.any();
    }
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.transports.values()).map((t) => t.close())
    );
    this.clients.clear();
    this.transports.clear();
  }
}
