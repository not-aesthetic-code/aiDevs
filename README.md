# Zadanie People (Wielka Korekta)

Pobranie listy osób spełniających kryteria (mężczyźni 20–40 lat, urodzeni w Grudziądzu, branża transportowa), otagowanie stanowisk przez LLM (Structured Output) i wysłanie odpowiedzi na Hub.

## Setup

```bash
npm install
cp .env.example .env
# Edytuj .env: ustaw HUB_API_KEY i ANTHROPIC_API_KEY
```

## Uruchomienie

```bash
npm run people
```

Skrypt: pobiera `people.csv` z Hubu → filtruje po płci/wieku/mieście → wysyła opisy stanowisk do Claude (batch, [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)) → wybiera osoby z tagiem `transport` → POST na `https://hub.ag3nts.org/verify`. Flaga w odpowiedzi – wpisz ją na https://hub.ag3nts.org/.
