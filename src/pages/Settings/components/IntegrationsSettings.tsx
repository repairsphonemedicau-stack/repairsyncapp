import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Link as LinkIcon, 
  CheckCircle2, 
  RefreshCw, 
  Trash2, 
  Play, 
  AlertCircle, 
  Clock, 
  Loader2, 
  Coins, 
  FileText, 
  User, 
  ChevronRight,
  Database,
  HelpCircle,
  MessageSquare,
  PhoneCall,
  Server,
  Send,
  Lock
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { useSettings } from '../../../providers/SettingsProvider';
import { useAuth } from '../../../providers/AuthProvider';
import { db } from '../../../firebase';
import { collection, query, onSnapshot, limit, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

function XeroSyncQueueMonitor() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [isProcessingLocal, setIsProcessingLocal] = useState(false);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  useEffect(() => {
    // Read the queue in real-time. Limiting to 50 for safety and speed.
    // We sort in-memory desc by created_at to avoid requiring a compound Firestore index.
    const q = query(companyCollection('xero_sync_queue'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const dbJobs = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      
      // Sort in-memory descending by created_at
      dbJobs.sort((a: any, b: any) => {
        const timeA = a.created_at?.seconds || a.created_at?.toMillis?.() || (a.created_at instanceof Date ? a.created_at.getTime() : 0);
        const timeB = b.created_at?.seconds || b.created_at?.toMillis?.() || (b.created_at instanceof Date ? b.created_at.getTime() : 0);
        return timeB - timeA;
      });
      setJobs(dbJobs);
    }, (error) => {
      console.error("Firestore listener error on sync queue:", error);
    });

    return () => unsubscribe();
  }, []);

  const handleManualProcess = async () => {
    try {
      setIsProcessingLocal(true);
      const res = await axios.post('/api/xero/sync/process');
      if (res.data?.success) {
        toast.success("Sync process ran", { description: "The server-side XeroSyncEngine finished running outstanding jobs." });
      } else {
        toast.error("Failed to run sync queue");
      }
    } catch (e: any) {
      console.error(e);
      toast.error("Process failed", { description: e.response?.data?.error || e.message });
    } finally {
      setIsProcessingLocal(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      const jobRef = companyDoc('xero_sync_queue', jobId);
      await updateDoc(jobRef, {
        status: 'PENDING',
        attempts: 0,
        last_error: '',
        updated_at: serverTimestamp()
      });
      toast.success("Job re-queued successfully", { description: "Set back to PENDING." });
    } catch (e: any) {
      toast.error("Failed to re-queue job", { description: e.message });
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm("Are you sure you want to delete this sync log from the queue?")) return;
    try {
      await deleteDoc(companyDoc('xero_sync_queue', jobId));
      toast.success("Sync job dismissed");
    } catch (e: any) {
      toast.error("Failed to delete sync job", { description: e.message });
    }
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case 'CUSTOMER': return <User className="w-4 h-4 text-sky-500" />;
      case 'INVOICE': return <FileText className="w-4 h-4 text-blue-500" />;
      case 'PAYMENT': return <Coins className="w-4 h-4 text-emerald-500" />;
      default: return <Database className="w-4 h-4 text-zinc-500" />;
    }
  };

  const filteredJobs = jobs.filter(job => {
    if (filter === 'all') return true;
    return job.status?.toLowerCase() === filter.toLowerCase();
  });

  return (
    <div className="mt-4 border border-zinc-200 shadow-sm rounded-2xl bg-white overflow-hidden">
      <div className="flex flex-col sm:flex-row bg-zinc-50 border-b border-zinc-200/60 p-5 items-start sm:items-center justify-between gap-4">
        <div>
          <h4 className="font-bold text-zinc-900 flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 text-blue-500 ${isProcessingLocal ? 'animate-spin' : ''}`} />
            Xero Sync Queue Monitor
          </h4>
          <p className="text-zinc-500 text-xs mt-0.5">Real-time sync process logs, queue diagnostic controls, and actions.</p>
        </div>
        
        <Button 
          onClick={handleManualProcess}
          disabled={isProcessingLocal}
          size="sm"
          className="rounded-xl bg-blue-600 hover:bg-blue-700 font-bold px-4 text-xs h-9 flex items-center gap-2 text-white shadow-none"
        >
          {isProcessingLocal ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              Process Queue Now
            </>
          )}
        </Button>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap items-center gap-1.5 pb-4 border-b border-zinc-100 mb-4">
          {['all', 'pending', 'processing', 'completed', 'failed'].map((s) => {
            const count = s === 'all' ? jobs.length : jobs.filter(j => j.status?.toLowerCase() === s).length;
            const isActive = filter === s;
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition ${
                  isActive 
                    ? 'bg-zinc-950 text-white shadow-sm' 
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70'
                }`}
              >
                {s} <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${isActive ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-200 text-zinc-500'}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {filteredJobs.length === 0 ? (
          <div className="py-12 text-center text-zinc-400 text-xs flex flex-col items-center justify-center gap-2">
            <Clock className="w-8 h-8 text-zinc-300 stroke-[1.5]" />
            <p className="font-medium text-zinc-500">No matching synchronization logs in queue</p>
            <p className="text-[11px] text-zinc-400">Updates will populate here as invoices or customer records are generated.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-100 text-zinc-400 font-semibold">
                  <th className="pb-3 w-1/4">Entity Description</th>
                  <th className="pb-3 w-1/4">Reference ID</th>
                  <th className="pb-3 w-1/8 text-center">Attempts</th>
                  <th className="pb-3 w-1/6">Sync Status</th>
                  <th className="pb-3 w-1/6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {filteredJobs.map((job) => {
                  const hasError = job.last_error && job.last_error.length > 0;
                  const isExpanded = expandedErrorId === job.id;
                  
                  return (
                    <React.Fragment key={job.id}>
                      <tr className="hover:bg-zinc-50/40 transition">
                        <td className="py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-zinc-50 flex items-center justify-center border border-zinc-200/50">
                              {getEntityIcon(job.entity_type)}
                            </div>
                            <div>
                              <div className="font-bold text-zinc-800 flex items-center gap-1.5 uppercase tracking-wide text-[10.5px]">
                                {job.entity_type}
                                <span className="text-[9px] font-semibold text-zinc-400 normal-case">({job.operation || 'CREATE'})</span>
                              </div>
                              <div className="text-xs text-zinc-400 pt-0.5 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-zinc-300" />
                                {job.created_at?.seconds 
                                  ? new Date(job.created_at.seconds * 1000).toLocaleString() 
                                  : 'Draft / Timestamp pending'
                                }
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 font-mono text-[11px] text-zinc-500 font-semibold max-w-[120px] truncate">
                          {job.entity_id}
                        </td>
                        <td className="py-3 text-center font-mono text-zinc-600 font-bold">
                          {job.attempts || 0}
                          <span className="text-zinc-300 font-normal">/7</span>
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider border ${
                              job.status === 'COMPLETED' 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                : job.status === 'FAILED'
                                  ? 'bg-rose-50 text-rose-700 border-rose-100 cursor-pointer hover:bg-rose-100/50 flex items-center gap-1'
                                  : job.status === 'PROCESSING'
                                    ? 'bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1'
                                    : 'bg-amber-50 text-amber-700 border-amber-100'
                            }`}
                            onClick={() => job.status === 'FAILED' && setExpandedErrorId(isExpanded ? null : job.id)}
                            >
                              {job.status === 'PROCESSING' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                              {job.status || 'PENDING'}
                              {job.status === 'FAILED' && <span className="text-[9px] font-semibold lowercase underline">(view error)</span>}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {(job.status === 'FAILED' || job.status === 'COMPLETED') && (
                              <Button 
                                onClick={() => handleRetryJob(job.id)}
                                variant="outline"
                                size="icon"
                                className="w-8 h-8 rounded-xl border-zinc-200 hover:bg-zinc-50"
                                title="Re-queue and Retry Synchronization"
                              >
                                <RefreshCw className="w-3.5 h-3.5 text-zinc-600" />
                              </Button>
                            )}
                            <Button 
                              onClick={() => handleDeleteJob(job.id)}
                              variant="outline"
                              size="icon"
                              className="w-8 h-8 rounded-xl border-zinc-200 text-rose-500 hover:bg-rose-50 hover:border-rose-100"
                              title="Delete job from queue logs"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {hasError && isExpanded && (
                        <tr>
                          <td colSpan={5} className="pb-3 pt-1">
                            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-100/60 text-[11px] text-rose-800 font-mono flex items-start gap-2.5">
                              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                              <div className="w-full">
                                <span className="font-bold block text-xs text-rose-950 uppercase tracking-wider mb-1">Xero API Fault Logs:</span>
                                {job.last_error}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

import { companyCollection, companyDoc } from "../../../lib/companyFirestore";

function IntegrationActionCard({
  title,
  description,
  icon: Icon,
  status,
  statusText,
  isProfessional,
  onEnable,
  onUpgrade,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  status: "connected" | "available" | "setup-required";
  statusText: string;
  isProfessional: boolean;
  onEnable: () => void;
  onUpgrade: () => void;
}) {
  const isConnected = status === "connected";
  const isSetupRequired = status === "setup-required";

  return (
    <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm">
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${isConnected ? 'bg-emerald-50 text-emerald-600' : isSetupRequired ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-500'}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-zinc-900">{title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${isConnected ? 'bg-emerald-50 text-emerald-700' : isSetupRequired ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
              {statusText}
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-zinc-500">{description}</p>
        </div>
      </div>
      <Button
        className="mt-4 w-full"
        variant={isConnected ? "outline" : "default"}
        onClick={isProfessional ? onEnable : onUpgrade}
      >
        {!isProfessional ? <Lock className="mr-2 h-4 w-4" /> : isConnected ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <LinkIcon className="mr-2 h-4 w-4" />}
        {!isProfessional ? "Switch to Professional" : isConnected ? "Connected" : isSetupRequired ? "Configure" : "Connect"}
      </Button>
    </div>
  );
}

type IntegrationCapabilities = {
  managedMobileMessage: boolean;
  managedRepairShopr: boolean;
  managedMaxotel: boolean;
};

const STATE_OPTIONS = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

const emptySenderRegistration = {
  abn: "",
  legalBusinessName: "",
  contactFirstName: "",
  contactLastName: "",
  contactEmail: "",
  businessStreetAddress: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
  website: "",
  businessPhoneNumber: "",
  senderId: "",
  senderIdContains: "",
  applyingOnBehalf: false,
  authorisationConfirmed: false,
};

export function IntegrationsSettings() {
  const [zohoStatus, setZohoStatus] = useState<"syncing" | "active" | "inactive">("syncing");
  const [xeroStatus, setXeroStatus] = useState<"syncing" | "active" | "inactive">("syncing");
  const [requestName, setRequestName] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [senderFormOpen, setSenderFormOpen] = useState(false);
  const [senderForm, setSenderForm] = useState(emptySenderRegistration);
  const [isSubmittingSender, setIsSubmittingSender] = useState(false);
  const [replyNumberNotes, setReplyNumberNotes] = useState("");
  const [replyNumberAreaCode, setReplyNumberAreaCode] = useState("");
  const [isSubmittingReplyNumber, setIsSubmittingReplyNumber] = useState(false);
  const [capabilities, setCapabilities] = useState<IntegrationCapabilities>({
    managedMobileMessage: false,
    managedRepairShopr: false,
    managedMaxotel: false,
  });
  const { settings, updateSettings } = useSettings();
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  
  const rcsEnabled = settings?.integrations?.rcsEnabled || false;
  const isProfessional =
    Boolean(profile?.subscriptionActive) &&
    (profile?.subscriptionPlan === "pro" || profile?.subscriptionPlan === "enterprise");
  const managedMessagingAccountReady = Boolean(
    settings?.integrations?.managedMessagingEnabled &&
      settings?.integrations?.managedMessagingAccountId
  );
  const managedMaxotelAccountReady = Boolean(settings?.integrations?.managedMaxotelEnabled);
  const smsSenderStatus = settings?.integrations?.smsSenderStatus || "not_started";
  const smsSenderActive = smsSenderStatus === "active" && Boolean(settings?.integrations?.smsSenderApprovedId);
  const smsSenderPending = smsSenderStatus === "pending";
  const smsReplyNumberStatus = settings?.integrations?.smsReplyNumberStatus || "not_started";
  const smsReplyNumberActive = smsReplyNumberStatus === "active" && Boolean(settings?.integrations?.smsReplyNumberAssigned);
  const smsReplyNumberPending = smsReplyNumberStatus === "pending";

  const requireProfessional = () => {
    toast.info("Professional subscription required", {
      description: "Switch subscriptions in Settings to connect SMS and phone integrations.",
    });
    navigate("/payments?plan=pro&interval=monthly");
  };

  const mobileMessageAvailable = capabilities.managedMobileMessage && smsSenderActive;
  const maxotelAvailable = capabilities.managedMaxotel;
  const smsRelayAvailable = (capabilities.managedMobileMessage && smsSenderActive) || capabilities.managedRepairShopr;
  const mobileMessageConnected = Boolean(
    managedMessagingAccountReady &&
      settings?.integrations?.mobileMessageEnabled &&
      smsSenderActive &&
      mobileMessageAvailable
  );
  const maxotelConnected = Boolean(
    (managedMaxotelAccountReady || settings?.integrations?.maxotelEnabled) &&
      maxotelAvailable
  );
  const smsRelayConnected = Boolean(
    managedMessagingAccountReady &&
      settings?.integrations?.smsRelayEnabled &&
      smsSenderActive &&
      smsRelayAvailable
  );

  const getActionStatus = (enabled: boolean, available: boolean) => {
    if (enabled && available) return { status: "connected" as const, statusText: "Connected" };
    if (available) return { status: "available" as const, statusText: "Available" };
    return { status: "setup-required" as const, statusText: "Setup Required" };
  };

  const openMessagingConfig = (title: string, description: string) => {
    toast.error(title, { description });
  };

  const updateIntegrationFlag = async (
    key: "mobileMessageEnabled" | "maxotelEnabled" | "smsRelayEnabled",
    available: boolean,
  ) => {
    if (!isProfessional) {
      requireProfessional();
      return;
    }
    if ((key === "mobileMessageEnabled" || key === "smsRelayEnabled") && !smsSenderActive) {
      setSenderFormOpen(true);
      toast.info("Sender ID required", {
        description: smsSenderPending
          ? "This company's Sender ID request is pending approval before live SMS can be enabled."
          : "Submit this company's Sender ID registration before enabling live SMS.",
      });
      return;
    }
    if (!available) {
      openMessagingConfig(
        "RepairSync managed service is not configured",
        "Users do not need API keys. The managed provider credentials must be set once in Cloud Run before this can be enabled for companies.",
      );
      return;
    }
    const response = await axios.post("/api/company/provision-messaging", {
      companyId: profile?.companyId,
      includePhone: true,
    });
    await updateSettings("integrations", response.data.integrations as any);
    toast.success("Company integration provisioned", {
      description: "The company messaging account is ready. Submit a Sender ID request before sending live SMS.",
    });
  };

  const updateSenderField = (key: keyof typeof emptySenderRegistration, value: string | boolean) => {
    setSenderForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmitSenderRegistration = async () => {
    if (!isProfessional) {
      requireProfessional();
      return;
    }
    try {
      setIsSubmittingSender(true);
      const response = await axios.post("/api/company/sms-sender-registration", {
        ...senderForm,
        companyId: profile?.companyId,
      });
      if (response.data?.integrations) {
        await updateSettings("integrations", response.data.integrations as any);
      }
      toast.success("Sender ID request saved", {
        description: "RepairSync support will register it with MobileMessage and activate SMS for this company after approval.",
      });
      setSenderFormOpen(false);
    } catch (error: any) {
      toast.error("Sender ID request failed", {
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setIsSubmittingSender(false);
    }
  };

  const handleRequestReplyNumber = async () => {
    if (!isProfessional) {
      requireProfessional();
      return;
    }
    try {
      setIsSubmittingReplyNumber(true);
      const response = await axios.post("/api/company/sms-reply-number-request", {
        companyId: profile?.companyId,
        companyName: profile?.companyName,
        preferredAreaCode: replyNumberAreaCode,
        notes: replyNumberNotes,
      });
      if (response.data?.integrations) {
        await updateSettings("integrations", response.data.integrations as any);
      }
      toast.success("Reply number request sent", {
        description: "RepairSync support will assign and activate a dedicated reply number for this company.",
      });
      setReplyNumberAreaCode("");
      setReplyNumberNotes("");
    } catch (error: any) {
      toast.error("Reply number request failed", {
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setIsSubmittingReplyNumber(false);
    }
  };

  const handleToggleRcs = async () => {
    if (!isProfessional) {
      requireProfessional();
      return;
    }
    try {
      await updateSettings('integrations', { rcsEnabled: !rcsEnabled });
      toast.success(`RCS Business Messaging ${!rcsEnabled ? 'enabled' : 'disabled'}`);
    } catch (e) {
      // Error handled by provider
    }
  };

  const refreshIntegrationStatus = async () => {
    try {
      const [zohoRes, xeroRes, capabilityRes] = await Promise.all([
        axios.get("/api/zoho/status", { validateStatus: () => true }),
        axios.get("/api/xero/status", { validateStatus: () => true }),
        axios.get("/api/integrations/capabilities", { validateStatus: () => true }),
      ]);
      setZohoStatus(zohoRes.status === 200 ? zohoRes.data.status : "inactive");
      setXeroStatus(xeroRes.status === 200 ? xeroRes.data.status : "inactive");
      if (capabilityRes.status === 200) {
        setCapabilities(capabilityRes.data);
      }
    } catch (e) {
      console.error("Failed to refresh status", e);
    }
  };

  useEffect(() => {
    refreshIntegrationStatus();
    
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        toast.success(`${event.data.integration === "zoho" ? "Zoho" : "Xero"} connected successfully!`);
        refreshIntegrationStatus();
      }
    };
    
    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, []);

  useEffect(() => {
    if (!isProfessional || !profile?.companyId || !settings?.integrations) return;
    if (
      managedMessagingAccountReady &&
      managedMaxotelAccountReady
    ) {
      return;
    }

    let cancelled = false;
    const provisionProfessionalIntegrations = async () => {
      try {
        const response = await axios.post("/api/company/provision-messaging", {
          companyId: profile.companyId,
          includePhone: true,
        });
        if (!cancelled && response.data?.integrations) {
          await updateSettings("integrations", response.data.integrations as any);
        }
      } catch (error) {
        console.warn("Automatic messaging provisioning failed", error);
      }
    };

    provisionProfessionalIntegrations();
    return () => {
      cancelled = true;
    };
  }, [
    isProfessional,
    profile?.companyId,
    settings?.integrations,
    managedMessagingAccountReady,
    managedMaxotelAccountReady,
    updateSettings,
  ]);

  const handleConnectZoho = async () => {
    if (!isProfessional) {
      requireProfessional();
      return;
    }
    try {
      const res = await axios.get("/api/auth/zoho/url");
      if (res.data.url) {
        window.open(res.data.url, "ZohoLogin", "width=800,height=600");
      }
    } catch (e: any) {
      toast.error("Failed to get Zoho auth URL", { description: e.message });
    }
  };

  const handleConnectXero = async () => {
    if (!isProfessional) {
      requireProfessional();
      return;
    }
    try {
      const res = await axios.get("/api/auth/xero/url");
      if (res.data.url) {
        window.open(res.data.url, "XeroLogin", "width=800,height=600");
      }
    } catch (e: any) {
      toast.error("Failed to get Xero auth URL", { description: e.message });
    }
  };

  const handleSubmitIntegrationRequest = async () => {
    try {
      setIsSubmittingRequest(true);
      const response = await axios.post("/api/integration-requests", {
        requestType: requestName.trim() ? "integration" : "support",
        integrationName: requestName.trim() || "Integration request",
        message: requestMessage,
        companyId: profile?.companyId,
        companyName: profile?.companyName,
        email: user?.email,
      });
      if (response.data?.success) {
        toast.success("Request sent", {
          description: "RepairSync support will review it from the admin portal.",
        });
        setRequestName("");
        setRequestMessage("");
      }
    } catch (error: any) {
      toast.error("Request failed", {
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm">
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${smsSenderActive ? 'bg-emerald-50 text-emerald-600' : smsSenderPending ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
            {smsSenderActive ? <CheckCircle2 className="w-5 h-5" /> : smsSenderPending ? <Clock className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-zinc-900">SMS Sender ID Registration</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${smsSenderActive ? 'bg-emerald-50 text-emerald-700' : smsSenderPending ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                {smsSenderActive ? 'Active' : smsSenderPending ? 'Pending approval' : 'Required'}
              </span>
            </div>
            <p className="mt-1 text-sm leading-5 text-zinc-500">
              Professional companies submit their own sender details here. RepairSync stores the request on this company and activates MobileMessage after the sender is approved.
            </p>
            {settings?.integrations?.smsSenderRequestedId && (
              <p className="mt-2 text-xs font-semibold text-zinc-600">
                Requested Sender ID: {settings.integrations.smsSenderRequestedId}
              </p>
            )}
          </div>
        </div>

        {!senderFormOpen ? (
          <Button
            className="mt-4 w-full"
            variant={smsSenderPending || smsSenderActive ? "outline" : "default"}
            onClick={() => {
              if (!isProfessional) return requireProfessional();
              const saved = settings?.integrations?.smsSenderRegistration as any;
              setSenderForm({
                ...emptySenderRegistration,
                ...(saved || {}),
                contactEmail: saved?.contactEmail || user?.email || "",
              });
              setSenderFormOpen(true);
            }}
          >
            {!isProfessional ? <Lock className="mr-2 h-4 w-4" /> : smsSenderActive ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <FileText className="mr-2 h-4 w-4" />}
            {!isProfessional ? "Switch to Professional" : smsSenderActive ? "View Sender Registration" : smsSenderPending ? "Update Pending Request" : "Request Sender ID"}
          </Button>
        ) : (
          <div className="mt-5 space-y-4 rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" placeholder="ABN" value={senderForm.abn} onChange={(e) => updateSenderField("abn", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" placeholder="Legal business / brand name" value={senderForm.legalBusinessName} onChange={(e) => updateSenderField("legalBusinessName", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" placeholder="Contact first name" value={senderForm.contactFirstName} onChange={(e) => updateSenderField("contactFirstName", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" placeholder="Contact last name" value={senderForm.contactLastName} onChange={(e) => updateSenderField("contactLastName", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400 sm:col-span-2" placeholder="Contact email" value={senderForm.contactEmail} onChange={(e) => updateSenderField("contactEmail", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400 sm:col-span-2" placeholder="Business street address" value={senderForm.businessStreetAddress} onChange={(e) => updateSenderField("businessStreetAddress", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400 sm:col-span-2" placeholder="Address line 2 optional" value={senderForm.addressLine2} onChange={(e) => updateSenderField("addressLine2", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" placeholder="Suburb / City" value={senderForm.suburb} onChange={(e) => updateSenderField("suburb", e.target.value)} />
              <select className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400" value={senderForm.state} onChange={(e) => updateSenderField("state", e.target.value)}>
                <option value="">State / Territory</option>
                {STATE_OPTIONS.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" placeholder="Postcode" value={senderForm.postcode} onChange={(e) => updateSenderField("postcode", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" placeholder="Business phone number" value={senderForm.businessPhoneNumber} onChange={(e) => updateSenderField("businessPhoneNumber", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400 sm:col-span-2" placeholder="Website, e.g. https://yourbusiness.com.au" value={senderForm.website} onChange={(e) => updateSenderField("website", e.target.value)} />
              <input className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-bold tracking-wide outline-none focus:border-zinc-400" placeholder="Sender ID, max 11 characters" value={senderForm.senderId} onChange={(e) => updateSenderField("senderId", e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 11))} />
              <select className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400" value={senderForm.senderIdContains} onChange={(e) => updateSenderField("senderIdContains", e.target.value)}>
                <option value="">Sender ID contains...</option>
                <option value="business_name">Business or brand name</option>
                <option value="trademark">Registered trademark</option>
                <option value="domain">Business domain name</option>
                <option value="abbreviation">Recognisable abbreviation</option>
              </select>
            </div>

            <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-zinc-700">
              <input type="checkbox" className="mt-1" checked={senderForm.applyingOnBehalf} onChange={(e) => updateSenderField("applyingOnBehalf", e.target.checked)} />
              <span>I am applying on behalf of this organisation.</span>
            </label>
            <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-zinc-700">
              <input type="checkbox" className="mt-1" checked={senderForm.authorisationConfirmed} onChange={(e) => updateSenderField("authorisationConfirmed", e.target.checked)} />
              <span>I confirm these details are authorised for this Sender ID request.</span>
            </label>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setSenderFormOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSubmitSenderRegistration} disabled={isSubmittingSender}>
                {isSubmittingSender ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Submit Request
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm">
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${smsReplyNumberActive ? 'bg-emerald-50 text-emerald-600' : smsReplyNumberPending ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
            {smsReplyNumberActive ? <CheckCircle2 className="w-5 h-5" /> : smsReplyNumberPending ? <Clock className="w-5 h-5" /> : <PhoneCall className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-zinc-900">Dedicated SMS Reply Number</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${smsReplyNumberActive ? 'bg-emerald-50 text-emerald-700' : smsReplyNumberPending ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'}`}>
                {smsReplyNumberActive ? 'Active' : smsReplyNumberPending ? 'Pending setup' : 'Optional'}
              </span>
            </div>
            <p className="mt-1 text-sm leading-5 text-zinc-500">
              Request a dedicated SMS number so customers can reply to messages and replies can route back to this company.
            </p>
            {settings?.integrations?.smsReplyNumberAssigned && (
              <p className="mt-2 text-xs font-semibold text-zinc-600">
                Assigned reply number: {settings.integrations.smsReplyNumberAssigned}
              </p>
            )}
          </div>
        </div>

        {smsReplyNumberActive ? (
          <Button className="mt-4 w-full" variant="outline">
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Reply Number Active
          </Button>
        ) : smsReplyNumberPending ? (
          <Button className="mt-4 w-full" variant="outline">
            <Clock className="mr-2 h-4 w-4" />
            Request Pending
          </Button>
        ) : (
          <div className="mt-4 space-y-3">
            <input
              value={replyNumberAreaCode}
              onChange={(event) => setReplyNumberAreaCode(event.target.value)}
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="Preferred area code optional, e.g. 07"
            />
            <textarea
              value={replyNumberNotes}
              onChange={(event) => setReplyNumberNotes(event.target.value)}
              className="min-h-20 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
              placeholder="Optional notes for the reply number setup"
            />
            <Button
              className="w-full"
              onClick={handleRequestReplyNumber}
              disabled={isSubmittingReplyNumber}
            >
              {!isProfessional ? <Lock className="mr-2 h-4 w-4" /> : isSubmittingReplyNumber ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PhoneCall className="mr-2 h-4 w-4" />}
              {!isProfessional ? "Switch to Professional" : "Request Reply Number"}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4">
        <IntegrationActionCard
          title="MobileMessage Gateway"
          description="Send real SMS messages to customer mobile numbers through the MobileMessage API and Australian carrier networks."
          icon={MessageSquare}
          {...getActionStatus(mobileMessageConnected, mobileMessageAvailable)}
          isProfessional={isProfessional}
          onEnable={() => updateIntegrationFlag("mobileMessageEnabled", mobileMessageAvailable)}
          onUpgrade={requireProfessional}
        />
        <IntegrationActionCard
          title="Maxotel Integration"
          description="Connect Maxotel for phone system logs, call routing records, and VoIP/SMS workflow visibility."
          icon={PhoneCall}
          {...getActionStatus(maxotelConnected, maxotelAvailable)}
          isProfessional={isProfessional}
          onEnable={() => updateIntegrationFlag("maxotelEnabled", maxotelAvailable)}
          onUpgrade={requireProfessional}
        />
        <IntegrationActionCard
          title="Backend SMS Relay"
          description="Route typed customer messages through /api/messaging/send, format numbers to E.164, dispatch via SMS gateway, and log status to Firestore."
          icon={Server}
          {...getActionStatus(smsRelayConnected, smsRelayAvailable)}
          isProfessional={isProfessional}
          onEnable={() => updateIntegrationFlag("smsRelayEnabled", smsRelayAvailable)}
          onUpgrade={requireProfessional}
        />
      </div>

      {/* Xero */}
      <div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <LinkIcon className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Xero Accounting</h3>
              <p className="text-sm text-zinc-500">Sync invoices and payments automatically</p>
            </div>
          </div>
          <Button 
            variant={xeroStatus === 'active' ? 'outline' : 'default'} 
            className={xeroStatus === 'active' ? 'border-green-200 text-green-700 hover:bg-green-50' : ''}
            onClick={handleConnectXero}
            disabled={xeroStatus === 'active'}
          >
            {xeroStatus === 'active' ? <><CheckCircle2 className="w-4 h-4 mr-2" /> Connected</> : isProfessional ? 'Connect' : 'Switch to Professional'}
          </Button>
        </div>

        {/* Real-time sync queue monitor, only available or shown for admins to inspect */}
        {xeroStatus === 'active' && <XeroSyncQueueMonitor />}
      </div>

      {/* Zoho */}
      <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-yellow-50 flex items-center justify-center shrink-0">
            <LinkIcon className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <h3 className="font-bold text-zinc-900">Zoho CRM / Mail</h3>
            <p className="text-sm text-zinc-500">Sync contacts and emails</p>
          </div>
        </div>
        <Button 
          variant={zohoStatus === 'active' ? 'outline' : 'default'} 
          className={zohoStatus === 'active' ? 'border-green-200 text-green-700 hover:bg-green-50' : ''}
          onClick={handleConnectZoho}
          disabled={zohoStatus === 'active'}
        >
          {zohoStatus === 'active' ? <><CheckCircle2 className="w-4 h-4 mr-2" /> Connected</> : isProfessional ? 'Connect' : 'Switch to Professional'}
        </Button>
      </div>
      
      {/* RCS Integration Settings */}
      <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
            <LinkIcon className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-bold text-zinc-900">RCS Business Messaging</h3>
            <p className="text-sm text-zinc-500">Enable Rich Communication Services for capable devices (Typing indicators, read receipts, rich cards)</p>
          </div>
        </div>
        <Button 
           variant={rcsEnabled ? 'outline' : 'default'} 
           className={rcsEnabled ? 'border-green-200 text-green-700 hover:bg-green-50' : ''}
           onClick={handleToggleRcs}
        >
          {rcsEnabled ? <><CheckCircle2 className="w-4 h-4 mr-2" /> Enabled</> : isProfessional ? 'Enable RCS' : 'Switch to Professional'}
        </Button>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-zinc-100 flex items-center justify-center shrink-0">
            <Send className="w-5 h-5 text-zinc-600" />
          </div>
          <div>
            <h3 className="font-bold text-zinc-900">Do not see the integration you need?</h3>
            <p className="text-sm text-zinc-500">Request an integration or support follow-up. It will appear in the RepairSync app admin portal.</p>
          </div>
        </div>
        <div className="grid gap-3">
          <input
            value={requestName}
            onChange={(event) => setRequestName(event.target.value)}
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
            placeholder="Integration name, e.g. MYOB, Shopify, Square"
          />
          <textarea
            value={requestMessage}
            onChange={(event) => setRequestMessage(event.target.value)}
            className="min-h-24 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
            placeholder="Tell us what you need connected and what workflow it should support."
          />
          <Button
            onClick={handleSubmitIntegrationRequest}
            disabled={isSubmittingRequest || requestMessage.trim().length < 8}
            className="w-full"
          >
            {isSubmittingRequest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Request Integration Now
          </Button>
        </div>
      </div>
    </div>
  );
}
