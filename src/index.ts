import { SupportCase } from "./support_case";
import PostalMime from 'postal-mime';
import { extractLatestReply } from './email_utils';

export { SupportCase };

export type SerializableEmailMessage = {
  from: string;
  to: string;
  messageId: string | null;
  subject: string | null;
  raw: string;
}

export default {
  // This acts as the API endpoint for the frontend
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const caseId = new URL(request.url).searchParams.get('caseId');

    if (!caseId) {
      return new Response("Case ID is missing", {status: 400});
    }

    // Get the DurableObject id and instance
    const id = env.SUPPORT_CASE.idFromName(caseId);
    const supportCase = env.SUPPORT_CASE.get(id);

    // We only want to handle clients that want to establish a websocket connection
    if (request.headers.get("Upgrade") != "websocket") {
      return new Response("expected websocket", {status: 400});
    }

    // Call the durable object to establish the websocket connection
    return supportCase.fetch(request.clone());
  },
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    // Avoid handling larger emails
    if (message.rawSize > 15000) {
      message.setReject("Sorry, we can't handle emails larger than 15000 bytes.");
      return;
    }

    // Limit the number of emails per email address
    const { success } = await env.RATE_LIMITER.limit({ key: message.from })

    if (!success) {
      message.setReject("Sorry, you've sent too many emails.");
      return;
    }

    // Extract who the email is addressed to
    const addressee = message.to.split('@')[0];

    // Parse the email contents, as messsage.row contains a ton of other stuff
    const email = await PostalMime.parse(message.raw);
    
    // Clean the email text to get only the latest reply
    const cleanedText = extractLatestReply(email.text || "");

    // We can't pass a ForwardableEmailMessage to a DurableObject, as it's not serializable, so create a serializable version
    const serializableMessage: SerializableEmailMessage = {
      from: message.from,
      to: message.to,
      messageId: message.headers.get("Message-ID"),
      subject: email.subject || "",
      raw: cleanedText  // Use the cleaned text instead of the full raw text
    };

    // If the email is addressed to support, we need to create a new case id else the addressees is the case id
    const caseId = addressee === "support" 
      ? `case-${crypto.randomUUID()}`
      : addressee;

    // Get the DurableObject id and instance
    const id = env.SUPPORT_CASE.idFromName(caseId);
    let supportCase = env.SUPPORT_CASE.get(id);

    // Call the durable object to handle the message, this is an RPC call
    await supportCase.handleMessage(serializableMessage, caseId);
  },
} satisfies ExportedHandler<Env>;
