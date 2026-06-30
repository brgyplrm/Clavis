import { useState, useEffect } from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { getRecoveryQuestions, verifyRecoveryAnswers } from "../../lib/tauri";
import { SECURITY_QUESTIONS } from "../setup/StepQuestions";

interface StepQuestionsProps {
  onVerified: (ans1: string, ans2: string) => void;
  onBack: () => void;
}

export default function StepQuestions({ onVerified, onBack }: StepQuestionsProps) {
  const [qIds, setQIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [ans1, setAns1] = useState("");
  const [ans2, setAns2] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    getRecoveryQuestions()
      .then(ids => {
        setQIds(ids);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load recovery questions:", err);
        setErrorMsg("Bypassed or no recovery security questions configured for this vault.");
        setLoading(false);
      });
  }, []);

  const getQuestionText = (id: number) => {
    const q = SECURITY_QUESTIONS.find(item => item.id === id);
    return q ? q.text : `Security Question #${id}`;
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ans1.trim() || !ans2.trim()) return;

    setErrorMsg(null);
    setVerifying(true);

    try {
      const correct = await verifyRecoveryAnswers(ans1, ans2);
      if (correct) {
        onVerified(ans1, ans2);
      } else {
        setErrorMsg("Incorrect security answers. Please try again.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple border-t-transparent" />
        <p className="text-[10px] text-muted-foreground">Loading recovery questions...</p>
      </div>
    );
  }

  // If question IDs are empty or failed to load, security is not configured
  const bypassed = qIds.length === 0 || qIds.every(id => id === 0);

  return (
    <div className="space-y-4 animate-fade-in text-left">
      <div className="text-center space-y-1">
        <h2 className="text-sm font-bold">Answer Security Questions</h2>
        <p className="text-[10px] text-muted-foreground leading-normal">
          Verify your identity to decrypt emergency key structures and reset your password.
        </p>
      </div>

      {bypassed ? (
        <div className="space-y-4">
          <div className="border border-danger/35 rounded-lg bg-danger/5 p-3 flex gap-2 text-[10px] text-danger leading-relaxed">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Recovery Pathway Unavailable</span>
              This vault was created by bypassing security questions. Recovery from database lockout is impossible. Please restore your database from external backups.
            </div>
          </div>
          <div className="flex justify-center pt-2">
            <Button
              onClick={onBack}
              className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-5 font-semibold cursor-pointer"
            >
              Back to Login
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleVerify} className="space-y-3">
          {/* Question 1 */}
          <div className="space-y-1">
            <span className="text-[9px] uppercase font-bold text-muted-foreground">Question 1</span>
            <p className="text-xs font-semibold text-foreground">{getQuestionText(qIds[0])}</p>
            <Input
              type="text"
              placeholder="Your answer"
              value={ans1}
              onChange={e => setAns1(e.target.value)}
              className="text-xs h-8.5 bg-card/20"
              autoFocus
            />
          </div>

          {/* Question 2 */}
          <div className="space-y-1">
            <span className="text-[9px] uppercase font-bold text-muted-foreground">Question 2</span>
            <p className="text-xs font-semibold text-foreground">{getQuestionText(qIds[1])}</p>
            <Input
              type="text"
              placeholder="Your answer"
              value={ans2}
              onChange={e => setAns2(e.target.value)}
              className="text-xs h-8.5 bg-card/20"
            />
          </div>

          {errorMsg && (
            <div className="border border-danger/35 rounded-lg bg-danger/5 p-2 text-[9px] text-danger font-semibold flex items-center gap-1.5 leading-normal">
              <AlertTriangle size={13} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex justify-between items-center pt-2 shrink-0">
            <button
              type="button"
              onClick={onBack}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 cursor-pointer font-medium"
            >
              <ArrowLeft size={12} /> Back to Login
            </button>
            <Button
              type="submit"
              disabled={verifying || !ans1.trim() || !ans2.trim()}
              className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-5 font-semibold cursor-pointer disabled:opacity-40"
            >
              {verifying ? "Verifying..." : "Verify Answers"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
