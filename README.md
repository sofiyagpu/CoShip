<div align="center">

<img src="apps/web/public/icons/icon-192.png" width="88" alt="CoShip" />

# CoShip

**Google Docs для внутренних приложений**

Создавайте приложения в любом AI-агенте или во встроенном редакторе.
Делитесь ими с командой, как документом.

<a href="https://github.com/sofiyagpu/CoShip">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github-readme-stats.vercel.app/api/pin/?username=sofiyagpu&repo=CoShip&hide_border=true&bg_color=0d1117&title_color=5ab4ff&icon_color=14b4ee&text_color=c9d1d9" />
    <img alt="CoShip" src="https://github-readme-stats.vercel.app/api/pin/?username=sofiyagpu&repo=CoShip&hide_border=true&title_color=3b5bf6&icon_color=14b4ee" />
  </picture>
</a>
<a href="https://github.com/sofiyagpu">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github-readme-stats.vercel.app/api/top-langs/?username=sofiyagpu&layout=compact&hide_border=true&bg_color=0d1117&title_color=5ab4ff&text_color=c9d1d9" />
    <img alt="Языки" src="https://github-readme-stats.vercel.app/api/top-langs/?username=sofiyagpu&layout=compact&hide_border=true&title_color=3b5bf6" />
  </picture>
</a>

</div>

## Почему CoShip

- **Любой агент.** Claude Code, Cursor, Codex или любой MCP-клиент — публикация одной командой. Сменили инструмент — приложения остались.
- **Встроенный редактор.** Опишите приложение словами — CoShip соберёт и опубликует его.
- **Вместе с командой.** Обсуждение рядом с приложением, комментарий превращается в новую версию.
- **Доступ как у документа.** Люди, группы, права на данные, версии и откат.

## Запуск

```sh
npm ci
npm run dev
```

Откройте http://127.0.0.1:5173.

## Публикация из агента

```sh
npm run cli -- login
npm run cli -- publish ./my-app
```

MCP-сервер: `npm run mcp -- --root /путь/к/проекту`.

## Документация

[Контракт приложения](docs/app-contract.md) · [Архитектура](docs/architecture.md) · [Размещение](docs/deployment.md)
