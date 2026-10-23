/**
 * MCP endpoint (Streamable HTTP, stateless, JSON responses). Auth: `Authorization: Bearer $MCP_TOKEN`.
 */
import { timingSafeEqual } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { buildServer } from '@/lib/mcp/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function authorized(req: Request): boolean {
  const want = process.env.MCP_TOKEN || ''
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!want || want.length < 24 || !got) return false
  const a = Buffer.from(want)
  const b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

function unauthorized() {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="kcasa-mcp"' },
  })
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) return unauthorized()
  const server = buildServer({ email: 'mcp', via: 'mcp' })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(req)
  } finally {
    // stateless: one server per request
    void transport.close().catch(() => null)
    void server.close().catch(() => null)
  }
}

export const POST = handle
export const GET = handle
export const DELETE = handle
