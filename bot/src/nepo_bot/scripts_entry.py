def repl_main() -> None:
    import asyncio

    from nepo_bot._repl import main

    asyncio.run(main())


def serve_main() -> None:
    import uvicorn

    from nepo_bot.config import get_settings

    settings = get_settings()
    uvicorn.run(
        "nepo_bot.app:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
