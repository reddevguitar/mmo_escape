# Mac mini deployment notes

맥미니에서 24시간 테스트 서버로 돌리는 최소 운영 절차입니다.

## 1. 서버 실행

```bash
npm install
PORT=8080 npm start
```

브라우저에서 확인:

```text
http://localhost:8080
```

같은 LAN의 다른 기기:

```text
http://맥미니_IP:8080
```

## 2. 백그라운드 실행

간단히 유지하려면 `pm2`를 사용합니다.

```bash
npm install -g pm2
pm2 start server.js --name mmo_escape
pm2 save
pm2 startup
```

상태 확인:

```bash
pm2 status
pm2 logs mmo_escape
```

## 3. 외부 공개

공유기에서 맥미니로 포트포워딩합니다.

- 외부 80/443 -> 맥미니 80/443
- 또는 테스트용으로 외부 8080 -> 맥미니 8080

운영용으로는 Caddy 리버스 프록시를 권장합니다.

```caddyfile
game.example.com {
  reverse_proxy localhost:8080
}
```

Caddy는 HTTPS와 WebSocket 업그레이드를 자동 처리합니다.

## 4. 보안 메모

- 지금 단계는 실험 서버입니다. 계정, 관리자 권한, 채팅 필터, rate limit은 아직 없습니다.
- 외부 공개 전에는 `MAX_PLAYERS`를 낮게 잡고 로그를 보면서 테스트하세요.
- 실제 도메인 공개는 4단계에서 프로세스 관리와 rate limit을 넣은 뒤 진행하는 편이 낫습니다.
