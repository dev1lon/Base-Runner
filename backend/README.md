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
### `POST /auth/nonce`
**Body**:
```json
{ "address": "0x...", "chainId": "0x14a34" }
```
**Response**:
```json
{ "ok": true, "nonce": "hex", "issuedAt": "2026-01-26T00:00:00.000Z" }
```

### `POST /auth/verify`
**Body**:
```json
{ "address": "0x...", "signature": "0x..." }
```
**Response**:
```json
{ "ok": true, "token": "jwt" }
```

### `POST /api/session/start`
**Auth**: Bearer token
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
**Auth**: Bearer token
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

### `GET /api/user/me`
**Auth**: Bearer token
Возвращает баланс coins, best score, streak и last check-in.

### `POST /api/checkin/start`
**Auth**: Bearer token
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
**Auth**: Bearer token
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
Авторизация проходит через nonce:
```
Base Runner
Address: 0x...
Nonce: <nonce>
ChainId: 0x14a34
IssuedAt: 2026-01-26T00:00:00.000Z
```

## Ограничения (текущие)
- Сессии в памяти процесса (после рестарта всё сбрасывается)
- Нет rate‑limit

Хранилище: Postgres (переменные `DATABASE_URL`, `PG_SSL`).
