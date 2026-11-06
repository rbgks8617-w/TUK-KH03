import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;

import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.buttons.Button;
import net.dv8tion.jda.api.entities.Guild;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.ButtonInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;

public class DiscordBot extends ListenerAdapter {
    private static final String JOIN_PREFIX = "numbergame:join:";

    private final Map<String, LinkedHashSet<String>> playersByRecruitment =
            new HashMap<>();

    public static void main(String[] args) throws InterruptedException {
        String token = System.getenv("DISCORD_BOT_TOKEN");
        String serverId = System.getenv("DISCORD_TEST_SERVER_ID");

        if (token == null || token.isBlank()
                || serverId == null || serverId.isBlank()) {
            throw new IllegalStateException("봇 토큰과 테스트 서버 ID를 설정하세요.");
        }

        JDA jda = JDABuilder.createLight(token)
                .addEventListeners(new DiscordBot())
                .build()
                .awaitReady();

        Guild server = jda.getGuildById(serverId);
        if (server == null) {
            jda.shutdown();
            throw new IllegalStateException("서버 ID와 봇이 설치된 서버를 확인하세요.");
        }

        server.upsertCommand("numbergame", "숫자 맞추기 참가자를 모집합니다.")
                .queue(command -> System.out.println("/numbergame 등록 완료"),
                        Throwable::printStackTrace);
    }

    @Override
    public synchronized void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        if (!event.getName().equals("numbergame")) {
            return;
        }

        String buttonId = JOIN_PREFIX + event.getId();
        playersByRecruitment.put(buttonId, new LinkedHashSet<>());

        event.reply("**숫자 맞추기 참가 모집**\n"
                        + "참여하려면 아래 **참가** 버튼을 눌러 주세요.")
                .addComponents(ActionRow.of(Button.success(buttonId, "참가")))
                .queue();
    }

    @Override
    public synchronized void onButtonInteraction(ButtonInteractionEvent event) {
        String buttonId = event.getComponentId();
        if (!buttonId.startsWith(JOIN_PREFIX)) {
            return;
        }

        LinkedHashSet<String> players = playersByRecruitment.get(buttonId);
        if (players == null) {
            event.reply("이 모집은 만료됐어요. `/numbergame`으로 다시 열어 주세요.")
                    .setEphemeral(true)
                    .queue();
            return;
        }

        if (!players.add(event.getUser().getId())) {
            event.reply("이미 참가했어요.").setEphemeral(true).queue();
            return;
        }

        event.reply("참가 완료! " + players.size() + "번째 참가자예요.")
                .setEphemeral(true)
                .queue();
    }
}