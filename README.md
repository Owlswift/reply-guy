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

## Run

```bash
npm run evaluate
```

## Swap implementations

```ts
// src/main.ts
const source = new MockSource();     // → TwitterSource()
const analyzer = new MockAnalyzer(); // → OpenAIAnalyzer()
const generator = new MockReplyGenerator(); // → OpenAIReplyGenerator()
```

No other code changes needed.