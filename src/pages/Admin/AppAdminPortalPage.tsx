import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { Building2, CheckCircle, Clock, Loader2, MessageSquare, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "../../providers/AuthProvider";

function formatDate(value: any) {
  const seconds = value?.seconds || value?._seconds;
  return seconds ? format(new Date(seconds * 1000), "PPpp") : "Timestamp pending";
}

export function AppAdminPortalPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [integrationRequests, setIntegrationRequests] = useState<any[]>([]);
  const [senderRequests, setSenderRequests] = useState<any[]>([]);
  const [replyNumberRequests, setReplyNumberRequests] = useState<any[]>([]);
  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [approvedSenderIds, setApprovedSenderIds] = useState<Record<string, string>>({});
  const [assignedReplyNumbers, setAssignedReplyNumbers] = useState<Record<string, string>>({});
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [supportReplies, setSupportReplies] = useState<Record<string, string>>({});
  const [savingSupportId, setSavingSupportId] = useState<string | null>(null);

  const headers = useMemo(() => ({
    "x-user-id": user?.uid || "",
    "x-user-email": user?.email || "",
  }), [user]);

  const fetchPortal = async () => {
    try {
      setLoading(true);
      const response = await axios.get("/api/app-admin/portal-summary", { headers });
      setCompanies(response.data.companies || []);
      setIntegrationRequests(response.data.integrationRequests || []);
      setSenderRequests(response.data.smsSenderRequests || []);
      setReplyNumberRequests(response.data.smsReplyNumberRequests || []);
      setSupportTickets(response.data.supportTickets || []);
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to load app admin portal");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void fetchPortal();
  }, [user]);

  const updateSenderStatus = async (request: any, status: "reviewing" | "active" | "rejected") => {
    const approvedSenderId = approvedSenderIds[request.id] || request.approvedSenderId || request.registration?.senderId || "";
    try {
      setSavingId(request.id);
      await axios.post(`/api/app-admin/sms-sender-requests/${request.id}/status`, {
        status,
        approvedSenderId,
        adminNotes: adminNotes[request.id] || "",
      }, { headers });
      toast.success(status === "active" ? "Sender ID activated" : "Sender request updated");
      await fetchPortal();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to update sender request");
    } finally {
      setSavingId(null);
    }
  };

  const updateReplyNumberStatus = async (request: any, status: "reviewing" | "active" | "rejected") => {
    const assignedNumber = assignedReplyNumbers[request.id] || request.assignedNumber || "";
    try {
      setSavingId(request.id);
      await axios.post(`/api/app-admin/sms-reply-number-requests/${request.id}/status`, {
        status,
        assignedNumber,
        adminNotes: adminNotes[request.id] || "",
      }, { headers });
      toast.success(status === "active" ? "Reply number activated" : "Reply number request updated");
      await fetchPortal();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to update reply number request");
    } finally {
      setSavingId(null);
    }
  };

  const replyToSupportTicket = async (ticket: any, status: "waiting" | "resolved" = "waiting") => {
    const body = supportReplies[ticket.id] || "";
    try {
      setSavingSupportId(ticket.id);
      await axios.post(`/api/app-admin/support-tickets/${ticket.id}/replies`, {
        body,
        status,
      }, { headers });
      toast.success("Support reply sent");
      setSupportReplies((current) => ({ ...current, [ticket.id]: "" }));
      await fetchPortal();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to send support reply");
    } finally {
      setSavingSupportId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-8 text-zinc-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading app admin portal...
      </div>
    );
  }

  const pendingSenders = senderRequests.filter((request) => request.status !== "active");
  const activeCompanies = companies.filter((company) => company.subscriptionActive).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-600">
            <ShieldCheck className="h-4 w-4" />
            RepairSync App Admin
          </div>
          <h1 className="mt-2 text-2xl font-bold text-zinc-900">Platform Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">Companies, support requests, integration requests, and MobileMessage Sender ID submissions.</p>
        </div>
        <Button variant="outline" onClick={fetchPortal}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <Building2 className="h-5 w-5 text-blue-600" />
          <p className="mt-3 text-2xl font-bold">{companies.length}</p>
          <p className="text-sm text-zinc-500">Companies</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <CheckCircle className="h-5 w-5 text-emerald-600" />
          <p className="mt-3 text-2xl font-bold">{activeCompanies}</p>
          <p className="text-sm text-zinc-500">Active subscriptions</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <MessageSquare className="h-5 w-5 text-indigo-600" />
          <p className="mt-3 text-2xl font-bold">{senderRequests.length}</p>
          <p className="text-sm text-zinc-500">Sender ID requests</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <Clock className="h-5 w-5 text-amber-600" />
          <p className="mt-3 text-2xl font-bold">{pendingSenders.length}</p>
          <p className="text-sm text-zinc-500">Pending sender actions</p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-zinc-900">Dedicated Reply Number Requests</h2>
        <div className="grid gap-4">
          {replyNumberRequests.map((request) => (
            <div key={request.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-zinc-900">{request.companyName || request.companyId || "Reply Number Request"}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${request.status === "active" ? "bg-emerald-50 text-emerald-700" : request.status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                      {request.status || "pending"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-1 text-sm text-zinc-600 md:grid-cols-2">
                    <span>Company ID: {request.companyId}</span>
                    <span>Requested by: {request.actorEmail || request.actorUserId || "-"}</span>
                    <span>Preferred area code: {request.preferredAreaCode || "-"}</span>
                    <span>Assigned number: {request.assignedNumber || "-"}</span>
                    <span>Requested: {formatDate(request.requestedAt)}</span>
                    <span>Notes: {request.notes || "-"}</span>
                  </div>
                </div>
                <div className="w-full space-y-2 lg:w-72">
                  <input
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm font-bold outline-none focus:border-zinc-400"
                    placeholder="Assigned reply number"
                    value={assignedReplyNumbers[request.id] ?? request.assignedNumber ?? ""}
                    onChange={(event) => setAssignedReplyNumbers((current) => ({ ...current, [request.id]: event.target.value.slice(0, 40) }))}
                  />
                  <textarea
                    className="min-h-20 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                    placeholder="Admin notes"
                    value={adminNotes[request.id] || ""}
                    onChange={(event) => setAdminNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <Button size="sm" variant="outline" disabled={savingId === request.id} onClick={() => updateReplyNumberStatus(request, "reviewing")}>Review</Button>
                    <Button size="sm" disabled={savingId === request.id} onClick={() => updateReplyNumberStatus(request, "active")}>Activate</Button>
                    <Button size="sm" variant="outline" disabled={savingId === request.id} onClick={() => updateReplyNumberStatus(request, "rejected")}>Reject</Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {replyNumberRequests.length === 0 ? <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">No dedicated reply number requests yet.</div> : null}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-zinc-900">Support Tickets</h2>
        <div className="grid gap-4">
          {supportTickets.map((ticket) => (
            <div key={ticket.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-zinc-900">{ticket.subject || "Support request"}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${ticket.status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {ticket.status || "open"}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold uppercase text-zinc-600">{ticket.priority || "normal"}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-600">{ticket.message}</p>
                  <div className="mt-3 grid gap-1 text-xs text-zinc-500">
                    <span>Company: {ticket.companyName || ticket.companyId || "-"}</span>
                    <span>User: {ticket.email || ticket.userId || "-"}</span>
                    <span>Updated: {formatDate(ticket.updatedAt || ticket.createdAt)}</span>
                  </div>
                  {ticket.replies?.length ? (
                    <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
                      {ticket.replies.map((reply: any) => (
                        <div key={reply.id} className={`rounded-xl p-3 text-sm ${reply.authorType === "admin" ? "bg-blue-50 text-blue-950" : "bg-zinc-50 text-zinc-700"}`}>
                          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide opacity-70">
                            {reply.authorType === "admin" ? "RepairSync Support" : "Customer"} · {formatDate(reply.createdAt)}
                          </div>
                          <p className="whitespace-pre-wrap leading-6">{reply.body}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="w-full space-y-2 lg:w-80">
                  <textarea
                    className="min-h-28 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                    placeholder="Reply to this support ticket"
                    value={supportReplies[ticket.id] || ""}
                    onChange={(event) => setSupportReplies((current) => ({ ...current, [ticket.id]: event.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" disabled={savingSupportId === ticket.id || (supportReplies[ticket.id] || "").trim().length < 2} onClick={() => replyToSupportTicket(ticket, "waiting")}>
                      Reply
                    </Button>
                    <Button size="sm" variant="outline" disabled={savingSupportId === ticket.id || (supportReplies[ticket.id] || "").trim().length < 2} onClick={() => replyToSupportTicket(ticket, "resolved")}>
                      Reply + Resolve
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {supportTickets.length === 0 ? <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">No support tickets yet.</div> : null}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-zinc-900">Sender ID Submissions</h2>
        <div className="grid gap-4">
          {senderRequests.map((request) => {
            const registration = request.registration || {};
            return (
              <div key={request.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-zinc-900">{registration.senderId || request.approvedSenderId || "Sender ID"}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${request.status === "active" ? "bg-emerald-50 text-emerald-700" : request.status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                        {request.status || "pending"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-1 text-sm text-zinc-600 md:grid-cols-2">
                      <span>Company: {registration.legalBusinessName || request.companyId}</span>
                      <span>ABN: {registration.abn || "-"}</span>
                      <span>Contact: {[registration.contactFirstName, registration.contactLastName].filter(Boolean).join(" ") || "-"}</span>
                      <span>Email: {registration.contactEmail || request.actorEmail || "-"}</span>
                      <span>Phone: {registration.businessPhoneNumber || "-"}</span>
                      <span>Website: {registration.website || "-"}</span>
                      <span>Address: {[registration.businessStreetAddress, registration.suburb, registration.state, registration.postcode].filter(Boolean).join(", ") || "-"}</span>
                      <span>Requested: {formatDate(request.requestedAt)}</span>
                    </div>
                  </div>
                  <div className="w-full space-y-2 lg:w-72">
                    <input
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm font-bold outline-none focus:border-zinc-400"
                      placeholder="Approved Sender ID"
                      value={approvedSenderIds[request.id] ?? request.approvedSenderId ?? registration.senderId ?? ""}
                      onChange={(event) => setApprovedSenderIds((current) => ({ ...current, [request.id]: event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 11) }))}
                    />
                    <textarea
                      className="min-h-20 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                      placeholder="Admin notes"
                      value={adminNotes[request.id] || ""}
                      onChange={(event) => setAdminNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Button size="sm" variant="outline" disabled={savingId === request.id} onClick={() => updateSenderStatus(request, "reviewing")}>Review</Button>
                      <Button size="sm" disabled={savingId === request.id} onClick={() => updateSenderStatus(request, "active")}>Activate</Button>
                      <Button size="sm" variant="outline" disabled={savingId === request.id} onClick={() => updateSenderStatus(request, "rejected")}>Reject</Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {senderRequests.length === 0 ? <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">No Sender ID submissions yet.</div> : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-zinc-900">Companies</h2>
          <div className="grid gap-3">
            {companies.map((company) => (
              <div key={company.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-zinc-900">{company.companyName}</h3>
                    <p className="break-all text-xs text-zinc-500">{company.id}</p>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold uppercase text-zinc-600">{company.subscriptionPlan || "no plan"}</span>
                </div>
                <div className="mt-3 grid gap-1 text-xs text-zinc-500">
                  <span>Users: {company.userCount}</span>
                  <span>Subscription: {company.subscriptionStatus || (company.subscriptionActive ? "active" : "inactive")}</span>
                  <span>SMS Sender: {company.smsSenderApprovedId || company.smsSenderRequestedId || "not requested"} ({company.smsSenderStatus})</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-bold text-zinc-900">Support and Integration Requests</h2>
          <div className="grid gap-3">
            {integrationRequests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-zinc-900">{request.integrationName || "Support request"}</h3>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold uppercase text-zinc-600">{request.requestType || "integration"}</span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">{request.status || "pending"}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{request.message}</p>
                <div className="mt-3 grid gap-1 text-xs text-zinc-500">
                  <span>Company: {request.companyName || request.companyId || "-"}</span>
                  <span>User: {request.email || request.userId || "-"}</span>
                  <span>{formatDate(request.createdAt)}</span>
                </div>
              </div>
            ))}
            {integrationRequests.length === 0 ? <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">No support or integration requests yet.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
