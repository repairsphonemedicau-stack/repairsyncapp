import React, { useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { HelpCircle, Loader2, MessageSquare, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "../../providers/AuthProvider";

function formatDate(value: any) {
  const seconds = value?.seconds || value?._seconds;
  return seconds ? format(new Date(seconds * 1000), "PPpp") : "Timestamp pending";
}

export function ClientSupportPage() {
  const { user, profile } = useAuth();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");

  const loadTickets = async () => {
    try {
      setLoading(true);
      const response = await axios.get("/api/support/tickets", {
        headers: {
          "x-user-id": user?.uid || "",
          "x-user-email": user?.email || "",
          "x-company-id": profile?.companyId || "",
        },
      });
      setTickets(response.data.tickets || []);
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && profile?.companyId) void loadTickets();
  }, [user, profile?.companyId]);

  const submitTicket = async () => {
    try {
      setSubmitting(true);
      await axios.post("/api/support/tickets", {
        subject,
        message,
        priority,
        companyId: profile?.companyId,
        companyName: profile?.companyName,
        email: user?.email,
      }, {
        headers: {
          "x-user-id": user?.uid || "",
          "x-user-email": user?.email || "",
          "x-company-id": profile?.companyId || "",
        },
      });
      toast.success("Support ticket sent");
      setSubject("");
      setMessage("");
      setPriority("normal");
      await loadTickets();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to send support ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <HelpCircle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Support</h1>
            <p className="text-sm text-zinc-500">Send RepairSync support a ticket and view replies from the app admin team.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-zinc-900">Create Support Ticket</h2>
          <div className="mt-4 space-y-3">
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="Subject"
            />
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as "normal" | "urgent")}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
            >
              <option value="normal">Normal priority</option>
              <option value="urgent">Urgent priority</option>
            </select>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="min-h-36 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm leading-6 outline-none focus:border-zinc-400"
              placeholder="Tell us what you need help with."
            />
            <Button className="w-full" onClick={submitTicket} disabled={submitting || subject.trim().length < 3 || message.trim().length < 8}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Support Ticket
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-zinc-900">Your Support Tickets</h2>
            <Button variant="outline" size="sm" onClick={loadTickets}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-zinc-200 bg-white p-10 text-zinc-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading tickets...
            </div>
          ) : (
            <div className="grid gap-3">
              {tickets.map((ticket) => (
                <article key={ticket.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-600" />
                    <h3 className="font-bold text-zinc-900">{ticket.subject}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${ticket.status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {ticket.status || "open"}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold uppercase text-zinc-600">{ticket.priority || "normal"}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-600">{ticket.message}</p>
                  <p className="mt-3 text-xs text-zinc-400">{formatDate(ticket.createdAt)}</p>
                  {ticket.replies?.length ? (
                    <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
                      {ticket.replies.map((reply: any) => (
                        <div key={reply.id} className={`rounded-xl p-3 text-sm ${reply.authorType === "admin" ? "bg-blue-50 text-blue-950" : "bg-zinc-50 text-zinc-700"}`}>
                          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide opacity-70">
                            {reply.authorType === "admin" ? "RepairSync Support" : "You"} · {formatDate(reply.createdAt)}
                          </div>
                          <p className="whitespace-pre-wrap leading-6">{reply.body}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
              {tickets.length === 0 ? (
                <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500">
                  No support tickets yet.
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
