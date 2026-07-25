# Aster

A Socratic study companion with an explorable, evidence-based learning universe.

## What is included

- Socratic chat powered by `deepseek-v4-pro`
- Five adjustable learning-depth levels
- Assignment/rubric context through paste or text-file attachment
- A navigable Three.js concept universe with prerequisite and adjacent-field links
- Structured learning-state updates after every tutor turn
- Evidence-based mastery, reachable suggestions, locked concepts, and milestones
- Local session and learning-map persistence
- Responsive chat/universe views for desktop and mobile

## Run locally

1. Copy `.env.example` to `.env.local` and add a DeepSeek API key.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.

The API key is used only by the server route and is never shipped to the browser.

## Production

Run `npm run typecheck` and `npm run build` before deployment. Configure these
runtime variables in the hosting environment:

```text
DEEPSEEK_API_KEY
DEEPSEEK_MODEL=deepseek-v4-pro
```

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
