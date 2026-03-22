from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import jobs, stems, search
from app.config import CORS_ORIGINS

app = FastAPI(title="Stem Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router, prefix="/api")
app.include_router(stems.router, prefix="/api")
app.include_router(search.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
