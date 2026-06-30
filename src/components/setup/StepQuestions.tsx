import { useState } from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

export const SECURITY_QUESTIONS = [
  { id: 1, text: "What was the name of your first pet?" },
  { id: 2, text: "What street did you grow up on?" },
  { id: 3, text: "What was your childhood nickname?" },
  { id: 4, text: "What is the name of the town where you were born?" },
  { id: 5, text: "What was the make and model of your first car?" },
  { id: 6, text: "What was the name of your first school?" },
  { id: 7, text: "What is your oldest sibling's middle name?" },
  { id: 8, text: "What was the name of your first employer?" }
];

interface StepQuestionsProps {
  onNext: (q1Id: number, a1: string, q2Id: number, a2: string) => void;
  onBack: () => void;
}

export default function StepQuestions({ onNext, onBack }: StepQuestionsProps) {
  const [q1Id, setQ1Id] = useState(1);
  const [q2Id, setQ2Id] = useState(2);
  const [a1, setA1] = useState("");
  const [a2, setA2] = useState("");
  
  // Skip confirmation dialog state
  const [confirmSkip, setConfirmSkip] = useState(false);

  const isValid = q1Id !== q2Id && a1.trim().length >= 3 && a2.trim().length >= 3;

  const handleNextClick = () => {
    if (isValid) {
      onNext(q1Id, a1.trim(), q2Id, a2.trim());
    }
  };

  const handleSkipConfirm = () => {
    // If skipped, we pass default question IDs and empty answers
    // Note: In E6-5 / forgot password, if config has empty answers, they will be prompted to restore from backups.
    onNext(0, "", 0, "");
  };

  return (
    <div className="flex flex-col h-full min-h-0 animate-fade-in justify-between text-left">
      {!confirmSkip ? (
        <>
          <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1">
            <div className="text-center space-y-1">
              <h2 className="text-sm font-bold">3. Set Security Questions</h2>
              <p className="text-[10px] text-muted-foreground leading-normal">
                Used to re-encrypt your vault and reset password if locked out.
              </p>
            </div>

            <div className="space-y-3">
              {/* Question 1 */}
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-muted-foreground">Security Question 1</label>
                <select
                  value={q1Id}
                  onChange={e => setQ1Id(Number(e.target.value))}
                  className="h-8.5 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-purple"
                >
                  {SECURITY_QUESTIONS.map(q => (
                    <option key={q.id} value={q.id} disabled={q.id === q2Id}>{q.text}</option>
                  ))}
                </select>
                <Input
                  type="text"
                  placeholder="Answer (minimum 3 characters)"
                  value={a1}
                  onChange={e => setA1(e.target.value)}
                  className="text-xs h-8.5 bg-card/20"
                />
              </div>

              {/* Question 2 */}
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-muted-foreground">Security Question 2</label>
                <select
                  value={q2Id}
                  onChange={e => setQ2Id(Number(e.target.value))}
                  className="h-8.5 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-purple"
                >
                  {SECURITY_QUESTIONS.map(q => (
                    <option key={q.id} value={q.id} disabled={q.id === q1Id}>{q.text}</option>
                  ))}
                </select>
                <Input
                  type="text"
                  placeholder="Answer (minimum 3 characters)"
                  value={a2}
                  onChange={e => setA2(e.target.value)}
                  className="text-xs h-8.5 bg-card/20"
                />
              </div>

              {/* Explanation Warning */}
              <div className="border border-purple/35 rounded-lg bg-purple-soft/5 p-3 flex gap-2 text-[9.5px] text-muted-foreground leading-normal">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-purple" />
                <div>
                  <strong className="text-foreground">Re-Encryption Pathway</strong>: Your answers are hashed using Argon2id to create a recovery key. This key encrypts a copy of your database key in your local config, allowing password resets without uploading your data anywhere.
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-border/40 shrink-0">
            <button
              onClick={onBack}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 cursor-pointer font-medium"
            >
              <ArrowLeft size={12} /> Back
            </button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmSkip(true)}
                className="text-[10px] text-muted-foreground hover:bg-muted text-xs h-8 px-4 font-semibold cursor-pointer"
              >
                Bypass Questions
              </Button>
              <Button
                disabled={!isValid}
                onClick={handleNextClick}
                className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-5 font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
              </Button>
            </div>
          </div>
        </>
      ) : (
        /* Explicit Skip Confirmation Gate */
        <div className="space-y-4 animate-fade-in py-2 flex-1 flex flex-col justify-center items-center">
          <div className="text-center space-y-2">
            <div className="h-10 w-10 bg-danger/10 text-danger rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle size={20} />
            </div>
            <h2 className="text-sm font-bold text-foreground">Skip Security Questions?</h2>
            <p className="text-[10.5px] text-muted-foreground leading-relaxed max-w-sm mx-auto">
              Warning: If you skip setting security questions, you will lose the ability to recover your passwords or reset your credentials if you ever forget your Master Password. Recovery from local database lockouts will be completely impossible.
            </p>
          </div>

          <div className="flex gap-3 justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmSkip(false)}
              className="text-xs h-8 px-4 font-semibold cursor-pointer"
            >
              No, Set Questions
            </Button>
            <Button
              onClick={handleSkipConfirm}
              className="bg-danger text-white hover:bg-danger/90 text-xs h-8 px-4 font-semibold cursor-pointer"
            >
              Yes, I Accept the Risk
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
