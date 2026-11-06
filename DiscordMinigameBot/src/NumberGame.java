import java.util.Scanner;
import java.util.Random;
public class NumberGame {
    private final int answer = new Random().nextInt(100) + 1;
    int count  = 0;
    int panswer = 0;
    NumberGame(int panswer){
        count++;
        this.panswer = panswer;
    }
    void outofanswer(){
        if(panswer != answer) {
            System.out.println("같지 않음.");
        }else{
            System.out.println("정답.");
        }
    }
}
