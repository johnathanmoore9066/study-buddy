# Aster

A Socratic study companion with an explorable, evidence-based learning universe.

## What is included

- Bring-your-own-key support for DeepSeek, OpenAI, Anthropic, Google, and
  OpenAI-compatible HTTPS providers
- Five adjustable learning-depth levels
- Assignment/rubric context through paste or text-file attachment
- A navigable, widely spaced Three.js concept universe with prerequisite and
  adjacent-field links and a broad travel range
- Structured learning-state updates after every tutor turn
- Evidence-based mastery, reachable suggestions, locked concepts, and persistent
  "aha" summaries titled in the learner's own words
- Local conversation, learning-map, and model-setting persistence
- A full blank-slate reset that preserves the model connection
- A flagship-model pricing snapshot with links to each provider's live pricing
- Responsive chat/universe views for desktop and mobile

## Run locally

1. Install dependencies with `npm install`.
2. Start the app with `npm run dev`.
3. Open `http://localhost:3000`.
4. Choose a provider and enter your own API key in the setup panel.

Study history stays in browser local storage. API keys are never stored on the
app server: they are held on the learner's device and sent through the app only
when a message is submitted. The learner can remember a key in local storage or
keep it for the current browser tab only.

## Production

Run `npm run typecheck` and `npm run build` before deployment. No provider API
keys or model environment variables are required.

## Product architecture

The model returns one structured tutor turn containing:

- the learner-facing Socratic response;
- the smallest current bottleneck concept;
- mastery evidence for that concept;
- up to three prerequisite, next, or adjacent concepts;
- optional response starters and milestone compression.

The UI owns the visual presentation and persistent graph. This avoids asking the
model to draw a brittle markdown tree, makes mastery updates inspectable, and lets
new concept nodes appear naturally as the learner changes subjects.
