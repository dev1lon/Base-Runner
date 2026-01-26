# BaseApp Runner Backend

Backend для проверки честности забегов (симуляция) и начисления coins.  
Старый фронтенд не изменён — этот сервис готов к подключению.

## Что делает
- Выдаёт сессию с seed
- Симулирует забег по input‑логам
- Сравнивает результат и начисляет coins
- Делает check-in с серией (streak)

## Запуск локально
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

## API
### `POST /api/session/start`
**Body** (опционально):
```json
{ "address": "0x...", "layout": "desktop" }
```
**Response**:
```json
{
  "sessionId": "uuid",
  "seed": "hex",
  "issuedAt": 123,
  "expiresAt": 456,
  "signMessage": "BaseApp Runner session <sessionId>",
  "config": { "frameMs": 16.666, "speedStart": 10, "speedMax": 17 }
}
```

### `POST /api/session/submit`
**Body**:
```json
{
  "sessionId": "uuid",
  "address": "0x...",
  "durationMs": 60000,
  "reportedScore": 3600,
  "inputLog": [
    { "t": 1200, "type": "jump" },
    { "t": 2400, "type": "duck_down" },
    { "t": 2800, "type": "duck_up" }
  ],
  "signature": "0x..."
}
```
**Response**:
```json
{
  "ok": true,
  "simScore": 3598,
  "coinsAwarded": 0,
  "coinBalance": 5,
  "bestScore": 8123,
  "collidedAtMs": 59000
}
```

### `GET /api/user/:address`
Возвращает баланс coins, best score, streak и last check-in.

### `POST /api/checkin/start`
**Body**:
```json
{ "address": "0x..." }
```
**Response**:
```json
{
  "ok": true,
  "message": "BaseApp Runner check-in <nonce>",
  "alreadyCheckedIn": false
}
```

### `POST /api/checkin/submit`
**Body**:
```json
{ "address": "0x...", "signature": "0x..." }
```
**Response**:
```json
{
  "ok": true,
  "coinsAwarded": 1,
  "bonusAwarded": 0,
  "streak": 3
}
```

## Важно про детерминизм
Симуляция использует **фиксированные параметры** из текущего клиента:
- скорость, гравитация, jumpVelocity
- размеры игрока/монет/птицы
- spawn‑логика

Если ты меняешь эти параметры на клиенте — **обнови их в `src/sim.js`**.

## Подпись кошельком
Если `REQUIRE_SIGNATURE=true`, нужно подписать сообщение:
```
BaseApp Runner session <sessionId>
```
и отправить подпись в `POST /api/session/submit`.

## Ограничения (текущие)
- Сессии в памяти процесса (после рестарта всё сбрасывается)
- Нет rate‑limit

Данные хранятся в JSON‑файле (`DB_PATH`). Для продакшена лучше Postgres.
