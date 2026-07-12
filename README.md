# Echo

An AI-powered social media assistant that helps you engage thoughtfully.

## Architecture

```
src/
├── main.ts                 # Entry point
├── types/
│   ├── tweet.ts           # Domain model: Tweet
│   ├── draft.ts           # Domain model: Draft
│   ├── analysis.ts        # Domain model: AnalysisResult
│   └── context.ts         # Pipeline context
├── sources/
│   ├── TweetSource.ts     # Interface
│   └── MockSource.ts      # Mock implementation
├── ai/
│   ├── Analyzer.ts        # Interface: analyze(tweet) → AnalysisResult
│   ├── ReplyGenerator.ts  # Interface: generate(tweet, analysis) → Draft
│   ├── MockAnalyzer.ts    # Mock implementation
│   └── MockReplyGenerator.ts
├── pipeline/
│   ├── PipelineStage.ts   # Generic interface
│   ├── Pipeline.ts        # Orchestrator
│   └── stages/
│       ├── FetchStage.ts
│       ├── AnalyzeStage.ts
│       ├── DraftStage.ts
│       └── ApprovalStage.ts
└── ui/
    └── display.ts         # Terminal output
```

## Two-stage AI

1. **Analyzer** — decides if a tweet is worth replying to (cheap)
2. **ReplyGenerator** — only runs if `shouldReply: true` (expensive)

This cuts API costs by ~80%.

## Setup

Run the setup script to start prerequisites:

```bash
npm run setup
```

This will:
- Start the Ollama server in the background
- Remind you to ensure the gpt-oss:20b model is available
- Display instructions for starting Chrome with remote debugging

**Note:** Chrome must be started manually in a separate terminal before running the bot:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-profile
```

## Run

```bash
npm run start:runner
```

## Swap implementations

```ts
// src/main.ts
const source = new MockSource();     // → TwitterSource()
const analyzer = new MockAnalyzer(); // → OpenAIAnalyzer()
const generator = new MockReplyGenerator(); // → OpenAIReplyGenerator()
```

No other code changes needed.