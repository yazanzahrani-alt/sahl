# Sahl

Sahl is a local full-stack prototype for Bupa Arabia’s reimbursement journey. Members choose a claim category, upload Arabic or English medical documents, review only detected issues, and submit structured claim data for processing.

## What it demonstrates

- Member ID, National ID, or Iqama login with JWT authentication
- Category-specific claim and document guidance
- PDF/image upload and OpenAI document analysis
- Document classification, extraction, and pre-submission validation
- Editable extracted details with source-document references
- Arabic/English UI with RTL support
- Submission-ready JSON and a read-only synthetic Ops view

The prototype prepares claims for processing; it does not approve claims, check coverage or eligibility, detect fraud, or connect to Bupa’s production systems. Use synthetic documents only.

## Stack

- React, TypeScript, Vite, Tailwind CSS
- NestJS, TypeScript, JWT
- Local SQLite storage
- OpenAI document intelligence (default presentation setup)

## Run locally

Requires Node.js 22+.

```powershell
npm install
Copy-Item backend/.env.example backend/.env
```

Add your OpenAI API key to `backend/.env`, then use two terminals:

```powershell
npm run dev:backend
```

```powershell
npm run dev:frontend
```

- Website: `http://localhost:5175`
- API: `http://localhost:3002/api`
- Swagger: `http://localhost:3002/api/docs`

## Environment

```env
PORT=3002
WEB_ORIGIN=http://localhost:5175,http://127.0.0.1:5175
NODE_ENV=development
SQLITE_PATH=./data/sahl.db
UPLOADS_PATH=./data/uploads
DEMO_OPS_ENABLED=true
DOCUMENT_INTELLIGENCE_PROVIDER=openai
OPENAI_MODEL=gpt-5.6-terra
# OPENAI_API_KEY=replace_with_your_key
OPENAI_TIMEOUT_MS=60000
OPENAI_MAX_RETRIES=2
```

Gemini remains an optional provider. Set `DOCUMENT_INTELLIGENCE_PROVIDER=gemini`,
`GEMINI_MODEL`, and `GEMINI_API_KEY` to use it. The OpenAI-specific timeout and
retry configuration above does not apply to Gemini.

SQLite data, uploaded documents, and the automatically generated JWT secret stay under `backend/data/` and are excluded from Git.
