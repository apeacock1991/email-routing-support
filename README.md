# Cloudflare Email Routing Demo - AI Support Agent

This repository implements a simple demo of an AI-powered email support agent using Cloudflare's Email Routing, Workers AI, Durable Objects, Workers and Rate Limiting.

## Features

- Handles incoming support emails using Cloudflare Email Workers
- Uses Workers AI (Llama 3.1) to generate contextual responses
- Maintains conversation history using Durable Objects with SQLite storage
- Rate limits to prevent abuse
- Sends responses via Mailgun

_Note: the migration in wrangler.json is set to v2 as I messed something up, and it was quicker to just bump to v2. If you try setting this up yourself, you can just use v1._

## How it Works

1. When an email is received:
   - If sent to `support@your-domain.com`, a new case ID is generated and a response is returned
   - If sent to `case-xxx@your-domain.com`, it's added to the existing case and a response is returned

2. The email is handled by a Durable Object which:
   - Stores the latest email and response in SQLite
   - Retrieves previous conversation history
   - Generates a response using Workers AI, passing in the conversation history and the latest email
   - Sends the response via Mailgun

Even though you can reply to emails using an Email Worker, Cloudflare only allow you to reply to the very first email in the thread in order to prevent abuse. This is why we use Mailgun to send all the emails.

## Setup

Required environment variables:

- `MAILGUN_DOMAIN`: Your Mailgun sending domain
- `EMAIL_DOMAIN`: The email domain you want to use to show visibily in the support case
- `APP_DOMAIN`: The domain to use in the link to the support case

Information on how to set them can be found [here](https://developers.cloudflare.com/workers/wrangler/configuration/#environment-variables). These are omitted from the repo so my domains aren't committed to the repo.

Because it's a demo, the domains are a bit all over the place!

Required secrets:

- `MAILGUN_API_KEY`: Your Mailgun API key

Information on how to set them can be found [here](https://developers.cloudflare.com/workers/configuration/secrets/#adding-secrets-to-your-project).

## Limitations

- Emails larger than 15KB are rejected, to prevent abuse.
- Rate limited to 5 emails per email address per minute, to prevent abuse.
- AI responses are limited to Cloudflare developer platform questions, although the prompt isn't very restrictive so you can get around it if you want to.
- The responses are not bad, but if I were doing this for real I would use a better model alongside RAG using Cloudflare's [llms-full.txt](https://developers.cloudflare.com/llms-full.txt).

## Deployment

Create a [Cloudflare account](https://www.cloudflare.com/en-gb/plans/free/) and deploy using Wrangler: 
```bash
wrangler deploy
```

_Note: you'll need a $5/month Workers Paid account to access Durable Objects._

## Cloudflare Products Used

- [Email Routing](https://developers.cloudflare.com/email-routing/)
- [Workers](https://developers.cloudflare.com/workers/)
- [Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
