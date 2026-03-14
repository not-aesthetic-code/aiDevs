 ---                                                                    
  Key Takeaways Applied
                                                                         
  1. Not all docs are text — use vision                     
                                                                         
  The lesson warns: "część dokumentacji może być dostarczona jako pliki
  graficzne". We hit this exactly with trasy-wylaczone.png. The pattern:
  fetch binary → base64 → send to vision model is reusable for any
  pipeline that processes mixed-format documents.

  2. Pass file references, not file content

  The lesson explains agents can't "see" a URL — they only see the
  decoded content. Our code does this correctly: we fetch the PNG,
  convert to base64, and pass that to Claude. When chaining agents, the
  same principle applies — pass the resolved content, not just a pointer.

  3. Workflow vs. agent — know when to pick which

  Our task was a workflow (fixed sequence, deterministic data), not an
  agent. The lesson is explicit: if the process is rigid and the data is
  static, a workflow is better. We used Haiku for one targeted vision
  call, not an agentic loop — correct choice.

  4. Model selection: fit to task, not habit

  We started with Opus instinctively. The lesson says: "wybór nie tej,
  która jest najwygodniejsza, lecz najlepiej dopasowana do problemu". For
   simple text extraction from a clear image → Haiku is enough. Reserve
  Opus/Sonnet for complex reasoning or ambiguous visuals.

  5. Attach metadata alongside the file

  The lesson shows adding a <media> tag next to the image so the agent
  knows the file reference. We approximated this by giving Claude a
  precise prompt alongside the base64 — same idea: image + context =
  usable signal.

  6. Iterative error-reading as a loop substitute

  The lesson describes agents retrying with feedback. We did the same
  manually: the hub returned "will not fit on the train", we read it,
  diagnosed WDP, and fixed. In a production agent you'd close this loop
  automatically.

  ---
  Reusable pattern from this task:
  fetch(url) → arrayBuffer → base64 → { type: "image", source: { type:
  "base64", ... } }
  Drop this anywhere you need to pass a non-text attachment to Claude —
  images, scanned PDFs rendered as PNGs, charts, etc.
