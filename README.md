# TUK-KH03
소프트웨어전공의 코딩 저장소

## DiscordMinigameBot

현재 플레이할 수 있는 게임은 **Color Tiles**입니다. 혼자 연습하거나 방을 만들어 최대 5명이 동시에 플레이할 수 있습니다. [배포된 게임 열기](https://tuk-kh03.onrender.com/)

### 다른 Windows 컴퓨터에서 이어서 작업하기

Git과 Node.js 24를 설치하세요. Java 콘솔 게임이나 채팅 봇도 작업한다면 IntelliJ IDEA와 JDK 25를 준비하세요.

처음 받는 경우 PowerShell에서 저장소를 내려받고 게임 폴더로 이동합니다.

```powershell
git clone https://github.com/rbgks8617-w/TUK-KH03.git
cd TUK-KH03
cd DiscordMinigameBot\color-tiles
node --version
node server.js
```

브라우저에서 [http://localhost:8080](http://localhost:8080)을 엽니다. 서버에 필요한 기능은 Node.js에 포함되어 있어 패키지 설치 단계는 없습니다. 포트가 사용 중이라면 아래처럼 다른 포트로 실행할 수 있습니다.

```powershell
$env:PORT = '8081'
node server.js
```

이 경우 [http://localhost:8081](http://localhost:8081)을 엽니다. 서버를 종료하려면 실행 중인 터미널에서 **Ctrl+C**를 누르세요. HTML이나 CSS를 바꿨을 때도 서버를 다시 실행하고 새로고침하세요. 서버가 시작될 때 게임 파일을 읽어 두기 때문입니다.

IntelliJ에서는 복제한 저장소의 `DiscordMinigameBot` 폴더를 열면 됩니다. 이미 저장소를 받은 데스크톱이라면, 저장소 루트에서 작업 상태를 먼저 확인하고 최신 `main`을 가져오세요.

```powershell
git status --short --branch
git switch main
git pull --ff-only origin main
```

### 플레이 방법

1. **혼자 시작**을 누르면 연습할 수 있습니다.
2. 멀티플레이는 닉네임을 입력하고 **방 만들기**를 누릅니다. 다른 참가자는 같은 게임 주소를 열고 닉네임과 **6자리 방 코드**를 입력한 뒤 **입장**합니다.
3. 두 명 이상 접속하면 방장이 **함께 시작**을 누릅니다. 모두 같은 20×20 게임판으로 시작하고, 자신의 타일을 따로 제거합니다.
4. 빈칸을 누르면 상하좌우 각 방향에서 가장 가까운 타일을 확인합니다. 같은 색이 2개 이상이면 해당 타일을 제거하고 타일당 1점을 얻습니다. 제한 시간은 2분이고, 매칭 실패 시 누른 사람의 시간만 10초 줄어듭니다.
5. 내 게임판은 가운데에, 상대 게임판은 시계 방향 순서로 양쪽에 표시됩니다. 좁은 화면에서는 상대 게임판을 내 게임판 아래 두 열에 배치합니다. 시간 종료 또는 클리어 시 최종 점수를 표시합니다.

한 컴퓨터에서 테스트할 때는 브라우저 탭을 두 개 이상 열고 다른 닉네임으로 같은 방에 입장하면 됩니다. 다른 컴퓨터에 있는 친구는 위의 Render 주소를 열고 같은 방 코드를 입력하면 됩니다. 서버 재시작이나 재배포 후에는 방을 새로 만드세요. 방과 점수는 실행 중인 서버의 메모리에 보관됩니다.

### 프로젝트 구조

| 경로 | 역할 |
| --- | --- |
| `DiscordMinigameBot/color-tiles/index.html` | 게임 화면 구조와 입장 폼 |
| `DiscordMinigameBot/color-tiles/style.css` | 화면 배치, 게임판, 결과 팝업, LevelUp 글꼴 |
| `DiscordMinigameBot/color-tiles/app.js` | 버튼 입력, 내 게임판, 상대 미리보기, 실시간 연결 |
| `DiscordMinigameBot/color-tiles/rules.js` | 20×20 게임판 생성과 타일 매칭 규칙 |
| `DiscordMinigameBot/color-tiles/server.js` | 게임 파일 제공, 방 관리, 점수 판정, 실시간 상태 전송 |
| `DiscordMinigameBot/color-tiles/fonts/` | LevelUp Regular·Bold 웹폰트, 라이선스, 저작권 고지 |
| `DiscordMinigameBot/src/` | Java 숫자 맞추기 콘솔 코드와 JDA 채팅 봇 코드 |

Color Tiles는 Node.js 서버에서 실행합니다. Java 채팅 봇을 작업하려면 IntelliJ에서 `pom.xml`을 Maven 프로젝트로 불러오고 JDK 25를 선택하세요. `DiscordBot.main()` 실행 설정의 환경 변수에 `DISCORD_BOT_TOKEN`과 `DISCORD_TEST_SERVER_ID`를 넣으면 테스트 서버에서 `/numbergame` 모집 버튼을 확인할 수 있습니다. 봇 토큰은 각 컴퓨터의 실행 설정에 입력하세요.

### Render 배포

Render에서 저장소를 **Web Service**로 연결하고 아래 값을 사용합니다.

| 항목 | 값 |
| --- | --- |
| Branch | `main` |
| Root Directory | `DiscordMinigameBot/color-tiles` |
| Language | `Node` |
| Build Command | `node --check server.js` |
| Start Command | `node server.js` |

서버는 Render가 제공하는 `PORT` 값을 사용합니다. 자동 배포를 켜 두었다면 `main`에 푸시한 뒤 Render의 **Deploys**에서 최신 커밋이 배포됐는지 확인하세요. 배포된 주소에서 방을 만들고 두 번째 탭에서 입장하면 화면과 실시간 연결을 함께 확인할 수 있습니다.

### Discord 활동 연결

1. Discord Developer Portal에서 **MinigamesBot → Activities → URL Mappings**를 엽니다.
2. **Prefix**는 `/`, **Target**은 `tuk-kh03.onrender.com`으로 저장합니다.
3. **Activities → Settings → Enable Activities**를 켭니다.
4. Discord 앱의 **사용자 설정 → 고급 → 개발자 모드**를 켠 뒤, 테스트 채널의 앱 실행 메뉴에서 **MinigamesBot**을 검색합니다.
5. 화면에서 방을 만들고, 다른 참가자가 같은 코드로 들어오는지 확인합니다. 미배포 활동의 실행 권한은 앱 소유자와 개발팀에 적용됩니다. 친구와 브라우저로 테스트할 때는 Render 주소를 공유하면 됩니다.

[Discord 활동 연결 안내](https://docs.discord.com/developers/activities/building-an-activity#step-4-running-your-app-in-discord)

### 변경 사항 저장하기

저장소를 복제한 데스크톱에서 아래처럼 게임 폴더의 변경 사항만 커밋할 수 있습니다. README도 수정했다면 `git add` 대상에 `README.md`를 추가하세요.

```powershell
git status --short
git add -- DiscordMinigameBot/color-tiles
git diff --cached --stat
git commit -m "Update Color Tiles"
git push origin main
```

게임 규칙을 참고한 원본은 [Game Saien Color Tiles](https://www.gamesaien.com/game/color_tiles/)입니다. LevelUp 글꼴은 SIL Open Font License 1.1로 배포되며, 관련 고지는 [폰트 폴더](DiscordMinigameBot/color-tiles/fonts)에 있습니다.
