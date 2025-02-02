import { DurableObject } from "cloudflare:workers";
import { SerializableEmailMessage } from "./index";

export class SupportCase extends DurableObject<Env> {
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

  async handleMessage(message: SerializableEmailMessage, caseId: string) {
    const msgBody = await this.generateReply(message);

    // Store the conversation history so it can be used in future messages
    this.sql.exec(`INSERT INTO support_history (message, role) VALUES (?, 'user');`, [message.raw]);
    this.sql.exec(`INSERT INTO support_history (message, role) VALUES (?, 'assistant');`, [msgBody]);

    await this.sendReply(message, msgBody, caseId);
  }

  private async generateReply(message: SerializableEmailMessage) {
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

    messages.push({ role: "user", content: "User message: " + message.raw });

    // Using Workers AI, call an LLM to generate a reply
    const answer = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages
    });

    return answer.response;
  }


  private async sendReply(message: SerializableEmailMessage, emailMessage: string, caseId: string) {
    // Construct the reply address, using the primary app domain (e.g. mydomain.com)
    // You can set them in the env within Wrangler, they are omitted from the repo
    const replyAddress = `${caseId}@${this.env.APP_DOMAIN}`;
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
    formData.append('text', emailMessage);

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
