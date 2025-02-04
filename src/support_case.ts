import { DurableObject } from "cloudflare:workers";
import { SerializableEmailMessage } from "./index";

export class SupportCase extends DurableObject<Env> {
  private sql: any;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Each time a new instance of a durable object is created, we need to create a table to store the conversation history
    this.sql.exec(`CREATE TABLE IF NOT EXISTS support_history(
      id INTEGER PRIMARY KEY,
      message TEXT,
      role TEXT
    );`);
  }

  async handleEmailMessage(message: SerializableEmailMessage, caseId: string) {
    const msgBody = await this.generateReply(message.raw);

    // Store the conversation history so it can be used in future messages
    this.sql.exec(`INSERT INTO support_history (message, role) VALUES (?, 'user');`, [message.raw]);
    this.sql.exec(`INSERT INTO support_history (message, role) VALUES (?, 'assistant');`, [msgBody]);

    await this.sendReply(message, msgBody, caseId);
  }

  // This will be called wehn the API wants to establish a websocket connection
  async fetch(request: Request) {
    const searchParams = new URL(request.url).searchParams;
    const role = searchParams.get('role') || "user";

    // Create a websocket pair and accept the connection on the server side
    let [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);

    // Query the support history table and send each message to the client
    let cursor = this.sql.exec("SELECT message, role FROM support_history ORDER BY id ASC;");
    let rows = cursor.toArray();
    
    for (const row of rows) {
      server.send(JSON.stringify({
        message: row.message,
        role: row.role
      }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // This will be called when the websocket receives a message
  async webSocketMessage(ws: WebSocket, message: string) {
    const data = JSON.parse(message) as any;

    // If there is an admin connected, simply broadcast the message to all clients as it's two humans talking
    // If no admin is connected, we prompt the AI to respond
    if (this.ctx.getWebSockets('admin').length === 0) {
      await this.handleAiChatMessage(ws, data.text);
    } else {
      await this.sendMessageToAllClients(data.text, data.role);
    }
  }

  // This will be called when the websocket is closed
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ) {
    ws.close(code, "Durable Object is closing WebSocket");
  }

  private async sendMessageToAllClients(message: string, role: string) {
    this.sql.exec(`INSERT INTO support_history (message, role) VALUES (?, ?)`, message, role);

    const websockets = this.ctx.getWebSockets()

    for(let x = 0; x < websockets.length; x++) {
      const session = websockets[x];

      session.send(
        JSON.stringify({
          message: message,
          role: role
        })
      );
    }
  }

  private async handleAiChatMessage(ws: WebSocket, user_message: string) {
    // This is incredibly wasteful, as we can just render the message on the client side,
    // but cheating for speed to handle both flows
    ws.send(JSON.stringify({
      message: user_message,
      role: 'user'
    }));

    const msgBody = await this.generateReply(user_message);

    this.sql.exec(`INSERT INTO support_history (message, role) VALUES (?, 'user');`, [user_message]);
    this.sql.exec(`INSERT INTO support_history (message, role) VALUES (?, 'assistant');`, [msgBody]);

    ws.send(JSON.stringify({
      message: msgBody,
      role: 'assistant'
    }));
  }
  
  private async generateReply(message_text: string) {
    // Get the conversation history
    let cursor = this.sql.exec("SELECT message, role FROM support_history ORDER BY id ASC;");
    let rows = cursor.toArray();

    // Construct the system prompt, add the conversation history and the latest message from the user
    const messages = [
      {
        role: "system",
        content: "You are a helpful support agent whose job is to answer questions about the " +
          "Cloudflare developer platform. You'll be given the conversation history, alongside " +
          "the latest messsage from the user. You need to respond to the user's message in a " +
          "way that is helpful and informative." +
          "You can ONLY RESPOND to questions about the Cloudflare developer platform, and you MUST reply in plain text."
      },
    ];

    for (const row of rows) {
      messages.push({ role: row.role, content: row.message });
    }

    messages.push({ role: "user", content: "User message: " + message_text });

    // Using Workers AI, call an LLM to generate a reply
    const answer = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages
    });

    return answer.response;
  }

  private async sendReply(message: SerializableEmailMessage, emailMessage: string, caseId: string) {
    // Construct the reply address, using the primary app domain (e.g. mydomain.com)
    // You can set them in the env within Wrangler, they are omitted from the repo
    const replyAddress = `${caseId}@${this.env.EMAIL_DOMAIN}`;
    // Construct the mailgun URL, using the mailgun domain (e.g. I used mg.mydomain.com)
    const mailgunUrl = `https://api.mailgun.net/v3/${this.env.MAILGUN_DOMAIN}/messages`;

    // Construct the form data to send to mailgun
    const formData = new URLSearchParams();
    formData.append('from', replyAddress);
    formData.append('to', message.from);
    formData.append('h:In-Reply-To', message.messageId || '');
    formData.append('subject',
      `Re: ${message.subject}`
    );
    formData.append('html', `<html><body><p>${emailMessage}</p><p>You can reply to this email to continue the conversation, or <a href="${this.env.APP_DOMAIN}?caseId=${caseId}">click here</a> to continue the conversation in the web interface.</p></body></html>`);

    // Email the reply to the user
    const response = await fetch(mailgunUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`api:${this.env.MAILGUN_API_KEY}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    if (response.ok) {
      console.log('Reply sent successfully');
    } else {
      const error = await response.text();
      console.log('Failed to send reply:', error);
    }
  }
}
