# Task 20 — Food Warehouse

## What the task asked for

Prepare 8 delivery orders (one per city) to satisfy food and tool requirements listed in `food4cities.json`.
Each order requires a correct `creatorID`, a numeric `destination` code, and a SHA1 `signature` computed by the `signatureGenerator` tool using the creator's `login` and `birthday` from the SQLite database.

## Approach

1. Fetch API help → understand tool surface (`orders`, `signatureGenerator`, `database`, `reset`, `done`).
2. Download `food4cities.json` → 8 cities with goods/quantities.
3. Query SQLite: `roles`, `users` (paginated — 78 rows), `destinations` (paginated — 40 rows).
4. Reset order state → call `reset` to restore seeded baseline.
5. Per city: generate signature → create order → batch-append items.
6. Call `done` → flag returned on success.

No LLM needed — the data is fully structured and logic is deterministic.

## Challenges

- **Response key discovery**: `show tables` returns `{ tables: [...] }`, SELECT returns `{ rows: [...] }`, `signatureGenerator` returns `{ hash: "..." }`, `orders create` returns `{ order: { id: "..." } }`. Had to discover each response shape by actually calling the API first.
- **Pagination**: The API returns at most 30 rows regardless of `LIMIT`. With `totalTableRows: 40` for destinations, a naive single-page fetch missed `Domatowo`. Fixed by paginating with `LIMIT 30 OFFSET N` until `offset >= totalTableRows`.
- **Wrong creator role**: First pick (role=1, "Pomoc techniczna") triggered `"The creator assigned to this order is not a person responsible for transport."` on `done`. Must use role=2 ("Obsługa transportów").
- **Rate limiting (429)**: Hub enforced a per-minute call limit. Required exponential backoff (5 s, 10 s, 20 s…) and an 800 ms polite delay after each successful call.

## Key learnings

- Always check **API help first** and log full responses — field names like `hash`, `order.id`, `rows` vs `tables` are not guessable.
- **Pagination matters**: if `totalTableRows > count`, there are more pages. Break the loop on `offset >= totalTableRows`, not on `rows.length < PAGE`.
- **Role-based authorization** can hide in the `done` validation, not in the `create` step. Always read the `done` error carefully — it pinpoints the exact problematic order and creator.
- Exponential backoff with a base delay prevents 429 cascades when making many sequential calls.

## Outcome

Task verified successfully. Flag returned by `done` after 8 orders (one per city) were created with the correct role-2 creator, matching `destination_id` codes, valid SHA1 signatures, and exact item quantities from `food4cities.json`.
