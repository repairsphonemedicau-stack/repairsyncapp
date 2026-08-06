import { Router } from 'express';
import { collection, collectionGroup, addDoc, updateDoc, doc, serverTimestamp, getDocs, getDoc, query, orderBy, where, setDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getApps as getAdminApps, initializeApp as initializeAdminApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

export const accountRouter = Router();

import { getServerAuthPromise, getServerDb } from '../firebase.js';
import { companyHasProfessionalAccess } from '../services/companyIntegrations.js';

const getDb = () => getServerDb();

function getFirebaseConfig() {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function getProvisioningDb() {
  const config = getFirebaseConfig();
  const app = getAdminApps().length
    ? getAdminApps()[0]
    : initializeAdminApp({
        projectId: config.projectId,
        credential: applicationDefault(),
      });
  return getAdminFirestore(app, config.firestoreDatabaseId || undefined);
}

// Helper to simulate authentication token decoding (since this is client sdk admin hybrid)
// For a real app with Firebase Admin, you would use admin.auth().verifyIdToken()
const checkAuth = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  // Simplification for the hybrid preview sandbox.
  // We assume the frontend passes the UID in an X-User-Id header for now as a makeshift auth
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = { uid: userId };
  next();
};

const checkAdmin = (req: any, res: any, next: any) => {
  // Simplification: In a real app check role from Firestore or Custom Claims
  const role = req.headers['x-user-role'];
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

const APP_ADMIN_EMAILS = new Set(
  String(process.env.REPAIRSYNC_APP_ADMIN_EMAILS || 'christinalucas1216@gmail.com,nemeanpartnersptyltd@gmail.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

const checkAppAdmin = (req: any, res: any, next: any) => {
  const email = String(req.headers['x-user-email'] || req.body?.email || '').trim().toLowerCase();
  if (!APP_ADMIN_EMAILS.has(email)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

function rankInviteCandidates(docs: any[], uid: string, email: string) {
  return docs
    .filter((candidate) => candidate.ref.path.startsWith("companies/"))
    .map((candidate) => {
      const [, companyId, , userDocId] = candidate.ref.path.split("/");
      const data = candidate.data();
      return { companyId, userDocId, data, ref: candidate.ref };
    })
    .filter((candidate) => candidate.companyId !== uid)
    .sort((a, b) => {
      const aScore =
        Number(a.userDocId === email) * 8 +
        Number(Boolean(a.data.invitedBy || a.data.invitedByEmail)) * 4 +
        Number(a.data.hasAccess !== false) * 2 +
        Number(Boolean(a.data.companyName));
      const bScore =
        Number(b.userDocId === email) * 8 +
        Number(Boolean(b.data.invitedBy || b.data.invitedByEmail)) * 4 +
        Number(b.data.hasAccess !== false) * 2 +
        Number(Boolean(b.data.companyName));
      return bScore - aScore;
    });
}

function createCompanyMessagingCredential(companyId: string) {
  const accountSuffix = crypto.randomBytes(6).toString('hex');
  const secret = `rsk_live_${crypto.randomBytes(32).toString('base64url')}`;
  const hash = crypto.createHash('sha256').update(secret).digest('hex');
  return {
    accountId: `rsmsg_${companyId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${accountSuffix}`,
    apiKeyHash: hash,
    apiKeyLast4: secret.slice(-4),
  };
}

async function ensureCompanyMessagingProvision(db: any, companyId: string, actorUid: string, options: { includePhone?: boolean } = {}) {
  const safeCompanyId = String(companyId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  const settingsRef = db.collection('companies').doc(safeCompanyId).collection('settings').doc('integrations');
  const settingsSnap = await settingsRef.get().catch(() => null);
  const settingsExists =
    typeof settingsSnap?.exists === 'function'
      ? settingsSnap.exists()
      : Boolean(settingsSnap?.exists);
  const existing = settingsExists ? settingsSnap.data() : {};
  const approvedSenderId = String(existing.smsSenderApprovedId || '').trim();
  const senderActive = existing.smsSenderStatus === 'active' && Boolean(approvedSenderId);
  const credential = existing.managedMessagingApiKeyHash && existing.managedMessagingAccountId
    ? {
        accountId: String(existing.managedMessagingAccountId),
        apiKeyHash: String(existing.managedMessagingApiKeyHash),
        apiKeyLast4: String(existing.managedMessagingApiKeyLast4 || ''),
      }
    : createCompanyMessagingCredential(safeCompanyId);

  const next = {
    mobileMessageEnabled: senderActive,
    smsRelayEnabled: senderActive,
    mobileMessageUsername: '',
    mobileMessagePassword: '',
    mobileMessageSenderId: approvedSenderId,
    repairShoprSubdomain: '',
    repairShoprApiKey: '',
    managedMessagingEnabled: true,
    managedMessagingMode: 'company_generated_account',
    managedMessagingProvider: 'repairsync_company_messaging',
    managedMessagingAccountId: credential.accountId,
    managedMessagingApiKeyHash: credential.apiKeyHash,
    managedMessagingApiKeyLast4: credential.apiKeyLast4,
    managedMessagingApiKeyCreatedAt: existing.managedMessagingApiKeyCreatedAt || FieldValue.serverTimestamp(),
    managedMessagingConfiguredAt: FieldValue.serverTimestamp(),
    managedMessagingConfiguredBy: actorUid,
    smsSenderStatus: existing.smsSenderStatus || 'not_started',
    smsSenderRequestedId: existing.smsSenderRequestedId || '',
    smsSenderApprovedId: approvedSenderId,
    ...(options.includePhone !== false
      ? {
          maxotelEnabled: true,
          maxotelApiKey: '',
          maxotelPhoneNumber: '',
          managedMaxotelEnabled: true,
          managedMaxotelMode: 'company_generated_account',
          managedMaxotelConfiguredAt: FieldValue.serverTimestamp(),
          managedMaxotelConfiguredBy: actorUid,
        }
      : {}),
  };

  await settingsRef.set(next, { merge: true });
  await db.collection('companies').doc(safeCompanyId).collection('audit_logs').add({
    action: 'MANAGED_MESSAGING_PROVISIONED',
    actorUserId: actorUid,
    accountId: credential.accountId,
    includePhone: options.includePhone !== false,
    timestamp: FieldValue.serverTimestamp(),
  }).catch(() => {});

  return {
    mobileMessageEnabled: senderActive,
    smsRelayEnabled: senderActive,
    mobileMessageSenderId: approvedSenderId,
    maxotelEnabled: Boolean(options.includePhone !== false || existing.maxotelEnabled),
    managedMessagingEnabled: true,
    managedMessagingMode: 'company_generated_account',
    managedMessagingProvider: 'repairsync_company_messaging',
    managedMessagingAccountId: credential.accountId,
    managedMessagingApiKeyLast4: credential.apiKeyLast4,
    smsSenderStatus: existing.smsSenderStatus || 'not_started',
    smsSenderRequestedId: existing.smsSenderRequestedId || '',
    smsSenderApprovedId: approvedSenderId,
    managedMaxotelEnabled: Boolean(options.includePhone !== false || existing.managedMaxotelEnabled),
  };
}

function textField(value: unknown, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeSenderId(value: unknown) {
  return textField(value, 11).replace(/[^a-zA-Z0-9]/g, '');
}

async function createEmailPasswordUser(email: string, password: string) {
  const firebaseConfig = getFirebaseConfig();
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: false,
      }),
    },
  );
  const data = await response.json();
  if (!response.ok && data?.error?.message !== 'EMAIL_EXISTS') {
    throw new Error(data?.error?.message || 'Failed to create Firebase Auth user');
  }
  if (data?.error?.message === 'EMAIL_EXISTS') {
    return { uid: null, alreadyExists: true };
  }
  return { uid: data.localId as string, alreadyExists: false };
}

accountRouter.post('/api/company/provision-messaging', checkAuth, checkAdmin, async (req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const companyId = String(req.body.companyId || req.headers['x-company-id'] || '').trim();
    if (!companyId) return res.status(400).json({ error: 'Missing company ID' });
    const integrations = await ensureCompanyMessagingProvision(db, companyId, req.user.uid, {
      includePhone: req.body.includePhone !== false,
    });
    res.json({ success: true, integrations });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to provision company messaging' });
  }
});

accountRouter.post('/api/company/sms-sender-registration', checkAuth, async (req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const companyId = String(req.body.companyId || req.headers['x-company-id'] || '').trim();
    if (!companyId) return res.status(400).json({ error: 'Missing company ID' });
    if (!(await companyHasProfessionalAccess(db, companyId, req.user.uid))) {
      return res.status(402).json({
        error: 'Professional subscription required to request SMS Sender ID registration.',
        upgradeRequired: true,
        requiredPlan: 'pro',
      });
    }

    const senderId = normalizeSenderId(req.body.senderId);
    if (senderId.length < 3) {
      return res.status(400).json({ error: 'Sender ID must be at least 3 alphanumeric characters.' });
    }

    const registration = {
      abn: textField(req.body.abn, 20),
      legalBusinessName: textField(req.body.legalBusinessName, 120),
      contactFirstName: textField(req.body.contactFirstName, 80),
      contactLastName: textField(req.body.contactLastName, 80),
      contactEmail: textField(req.body.contactEmail || req.headers['x-user-email'], 160).toLowerCase(),
      businessStreetAddress: textField(req.body.businessStreetAddress, 180),
      addressLine2: textField(req.body.addressLine2, 180),
      suburb: textField(req.body.suburb, 80),
      state: textField(req.body.state, 40),
      postcode: textField(req.body.postcode, 12),
      website: textField(req.body.website, 180),
      businessPhoneNumber: textField(req.body.businessPhoneNumber, 40),
      senderId,
      senderIdContains: textField(req.body.senderIdContains, 80),
      applyingOnBehalf: Boolean(req.body.applyingOnBehalf),
      authorisationConfirmed: Boolean(req.body.authorisationConfirmed),
    };

    const required = [
      ['legalBusinessName', 'Legal business / brand name'],
      ['contactFirstName', 'Contact first name'],
      ['contactLastName', 'Contact last name'],
      ['contactEmail', 'Contact email'],
      ['businessStreetAddress', 'Business street address'],
      ['suburb', 'Suburb / City'],
      ['state', 'State / Territory'],
      ['postcode', 'Postcode'],
      ['website', 'Website'],
      ['businessPhoneNumber', 'Business phone number'],
      ['senderIdContains', 'Sender ID contains'],
    ] as const;
    const missing = required.find(([key]) => !registration[key]);
    if (missing) return res.status(400).json({ error: `${missing[1]} is required.` });
    if (!registration.authorisationConfirmed) {
      return res.status(400).json({ error: 'Authorisation confirmation is required.' });
    }

    const companyRef = db.collection('companies').doc(companyId);
    const settingsRef = companyRef.collection('settings').doc('integrations');
    const requestRef = db.collection('smsSenderRequests').doc();
    const provision = await ensureCompanyMessagingProvision(db, companyId, req.user.uid, { includePhone: true });
    const responsePatch = {
      ...provision,
      mobileMessageEnabled: false,
      smsRelayEnabled: false,
      mobileMessageSenderId: '',
      smsSenderStatus: 'pending',
      smsSenderRequestedId: senderId,
      smsSenderApprovedId: '',
      smsSenderRegistration: registration,
      smsSenderRequestId: requestRef.id,
    };
    const firestorePatch = {
      ...responsePatch,
      smsSenderRequestedAt: FieldValue.serverTimestamp(),
      smsSenderRequestedBy: req.user.uid,
    };

    await Promise.all([
      settingsRef.set(firestorePatch, { merge: true }),
      requestRef.set({
        companyId,
        actorUserId: req.user.uid,
        actorEmail: textField(req.headers['x-user-email'], 160).toLowerCase(),
        status: 'pending',
        registration,
        requestedAt: FieldValue.serverTimestamp(),
      }),
      companyRef.collection('audit_logs').add({
        action: 'SMS_SENDER_ID_REQUESTED',
        actorUserId: req.user.uid,
        senderId,
        requestId: requestRef.id,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {}),
    ]);

    res.json({ success: true, integrations: responsePatch });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to submit SMS Sender ID request' });
  }
});

accountRouter.post('/api/company/sms-reply-number-request', checkAuth, async (req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const companyId = String(req.body.companyId || req.headers['x-company-id'] || '').trim();
    if (!companyId) return res.status(400).json({ error: 'Missing company ID' });
    if (!(await companyHasProfessionalAccess(db, companyId, req.user.uid))) {
      return res.status(402).json({
        error: 'Professional subscription required to request a dedicated reply number.',
        upgradeRequired: true,
        requiredPlan: 'pro',
      });
    }

    const requestRef = db.collection('smsReplyNumberRequests').doc();
    const companyRef = db.collection('companies').doc(companyId);
    const settingsRef = companyRef.collection('settings').doc('integrations');
    const requestPayload = {
      companyId,
      companyName: textField(req.body.companyName, 140),
      actorUserId: req.user.uid,
      actorEmail: textField(req.headers['x-user-email'], 160).toLowerCase(),
      status: 'pending',
      preferredAreaCode: textField(req.body.preferredAreaCode, 12),
      notes: textField(req.body.notes, 500),
      requestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const integrationPatch = {
      smsReplyNumberStatus: 'pending',
      smsReplyNumberRequestId: requestRef.id,
      smsReplyNumberRequestedAt: FieldValue.serverTimestamp(),
      smsReplyNumberAssigned: '',
    };

    await Promise.all([
      requestRef.set(requestPayload),
      settingsRef.set(integrationPatch, { merge: true }),
      companyRef.collection('audit_logs').add({
        action: 'SMS_REPLY_NUMBER_REQUESTED',
        actorUserId: req.user.uid,
        requestId: requestRef.id,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {}),
    ]);

    res.json({
      success: true,
      integrations: {
        smsReplyNumberStatus: 'pending',
        smsReplyNumberRequestId: requestRef.id,
        smsReplyNumberAssigned: '',
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to request reply number' });
  }
});

accountRouter.post('/api/admin/apple-review/professional', checkAuth, checkAdmin, async (req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const reviewEmail = 'tryonapptestuser@gmail.com';
    const userSnap = await db.collection('users').where('email', '==', reviewEmail).limit(1).get();
    const companyUsersSnap = await db.collectionGroup('users').where('email', '==', reviewEmail).limit(5).get();
    const userDoc = userSnap.docs[0] || null;
    const companyUserDoc = companyUsersSnap.docs.find((candidate: any) => candidate.ref.path.startsWith('companies/')) || null;
    const companyId =
      (userDoc?.data()?.companyId as string | undefined) ||
      (companyUserDoc ? companyUserDoc.ref.path.split('/')[1] : null);
    const uid = userDoc?.id || companyUserDoc?.data()?.uid || null;

    if (!companyId || !uid) {
      return res.status(404).json({ error: 'Apple review user/company was not found.' });
    }

    const companyName = 'RepairSync Review Company';
    const profilePatch = {
      email: reviewEmail,
      companyId,
      companyName,
      role: 'admin',
      permissions: ['admin'],
      hasAccess: true,
      billingRequired: false,
      subscriptionActive: true,
      subscriptionStatus: 'active',
      subscriptionPlan: 'pro',
      subscriptionInterval: 'yearly',
      subscriptionSource: 'app_review',
      subscriptionGrandfathered: false,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await Promise.all([
      db.collection('users').doc(String(uid)).set({ uid, ...profilePatch }, { merge: true }),
      db.collection('companies').doc(companyId).set({
        companyName,
        billingOwnerUid: uid,
        subscriptionActive: true,
        subscriptionStatus: 'active',
        subscriptionPlan: 'pro',
        subscriptionInterval: 'yearly',
        subscriptionSource: 'app_review',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      db.collection('companies').doc(companyId).collection('users').doc(String(uid)).set({
        uid,
        ...profilePatch,
        linkedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      db.collection('companies').doc(companyId).collection('users').doc(reviewEmail).set({
        uid,
        ...profilePatch,
        linkedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);

    const integrations = await ensureCompanyMessagingProvision(db, companyId, String(uid), { includePhone: true });
    res.json({ success: true, companyId, uid, integrations });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update Apple review account.' });
  }
});

accountRouter.post('/api/team/invite', checkAuth, checkAdmin, async (req: any, res: any) => {
  try {
    const db = getDb();
    const adminId = req.user.uid;
    const email = String(req.body.email || '').trim().toLowerCase();
    const displayName = String(req.body.displayName || '').trim();
    const authMethod = req.body.authMethod === 'email_password'
      ? 'email_password'
      : req.body.authMethod === 'apple'
        ? 'apple'
        : 'google';
    const password = String(req.body.password || '');
    const companyId = String(req.body.companyId || req.headers['x-company-id'] || '').trim();
    const companyName = String(req.body.companyName || '').trim() || null;

    if (!companyId) return res.status(400).json({ error: 'Missing company ID' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (authMethod === 'email_password' && password.length < 8) {
      return res.status(400).json({ error: 'Temporary password must be at least 8 characters' });
    }

    let authUid: string | null = null;
    let alreadyExists = false;
    if (authMethod === 'email_password') {
      const created = await createEmailPasswordUser(email, password);
      authUid = created.uid;
      alreadyExists = created.alreadyExists;
    }

    const memberData = {
      uid: authUid,
      email,
      displayName: displayName || null,
      role: 'tech',
      permissions: ['tickets', 'customers', 'messages', 'tasks', 'invoices', 'inventory'],
      hasAccess: true,
      billingRequired: false,
      subscriptionActive: true,
      subscriptionStatus: 'active',
      subscriptionSource: 'company_invite',
      authMethod,
      companyId,
      companyName,
      invitedBy: adminId,
      invitedByEmail: req.headers['x-user-email'] || null,
      addedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, 'companies', companyId, 'users', email), memberData, { merge: true });
    await setDoc(doc(db, 'team_invites', email), memberData, { merge: true });

    if (authUid) {
      await setDoc(doc(db, 'companies', companyId, 'users', authUid), {
        ...memberData,
        uid: authUid,
        linkedAt: serverTimestamp(),
      }, { merge: true });
      await setDoc(doc(db, 'users', authUid), {
        uid: authUid,
        email,
        displayName: displayName || null,
        companyId,
        companyName,
        role: 'tech',
        permissions: memberData.permissions,
        hasAccess: true,
        billingRequired: false,
        subscriptionActive: true,
        subscriptionStatus: 'active',
        subscriptionSource: 'company_invite',
        invitedBy: adminId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    await addDoc(collection(db, 'companies', companyId, 'audit_logs'), {
      action: 'TEAM_MEMBER_INVITED',
      actorUserId: adminId,
      targetEmail: email,
      authMethod,
      timestamp: serverTimestamp(),
    }).catch(() => {});

    res.json({ success: true, uid: authUid, alreadyExists, authMethod });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

accountRouter.post('/api/team/resolve-invite', checkAuth, async (req: any, res: any) => {
  try {
    await getServerAuthPromise();
    const db = getDb();
    const uid = String(req.user.uid || '').trim();
    const email = String(req.body.email || req.headers['x-user-email'] || '').trim().toLowerCase();
    const displayName = String(req.body.displayName || '').trim() || null;
    const photoURL = String(req.body.photoURL || '').trim() || null;

    if (!uid) return res.status(400).json({ error: 'Missing user ID' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const snapshot = await getDocs(query(collectionGroup(db, 'users'), where('email', '==', email)));
    const invite = rankInviteCandidates(snapshot.docs, uid, email)[0];
    if (!invite) {
      return res.json({ found: false });
    }

    const companyId = invite.companyId;
    const inviteData = invite.data || {};
    const role = inviteData.role === 'admin' ? 'admin' : 'tech';
    const permissions = Array.isArray(inviteData.permissions)
      ? inviteData.permissions
      : ['tickets', 'customers', 'messages', 'tasks', 'invoices', 'inventory'];
    const companyName = inviteData.companyName || null;
    const hasAccess = inviteData.hasAccess !== false;

    const profile = {
      uid,
      email,
      displayName: displayName || inviteData.displayName || null,
      photoURL,
      companyId,
      companyName,
      role,
      permissions,
      hasAccess,
      billingRequired: false,
      subscriptionActive: true,
      subscriptionStatus: 'active',
      subscriptionSource: 'company_invite',
      invitedBy: inviteData.invitedBy || null,
      updatedAt: serverTimestamp(),
    };

    await Promise.all([
      setDoc(doc(db, 'users', uid), {
        ...profile,
        createdAt: serverTimestamp(),
      }, { merge: true }),
      setDoc(doc(db, 'companies', companyId, 'users', uid), {
        ...profile,
        linkedAt: serverTimestamp(),
      }, { merge: true }),
      setDoc(doc(db, 'companies', companyId, 'users', email), {
        uid,
        email,
        displayName: profile.displayName,
        photoURL,
        companyId,
        companyName,
        role,
        permissions,
        hasAccess,
        authMethod: inviteData.authMethod || 'google',
        linkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
      setDoc(doc(db, 'team_invites', email), {
        uid,
        email,
        displayName: profile.displayName,
        photoURL,
        companyId,
        companyName,
        role,
        permissions,
        hasAccess,
        authMethod: inviteData.authMethod || 'google',
        invitedBy: inviteData.invitedBy || null,
        linkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true }),
    ]);

    res.json({
      found: true,
      profile: {
        companyId,
        companyName,
        role,
        permissions,
        hasAccess,
        billingRequired: false,
        subscriptionActive: true,
        subscriptionStatus: 'active',
        subscriptionSource: 'company_invite',
      },
    });
  } catch (error: any) {
    console.error('[team/resolve-invite] failed', error);
    res.status(500).json({ error: error.message || 'Failed to resolve invite' });
  }
});

// 1. Request Account Deletion
accountRouter.post('/api/account/delete-request', checkAuth, async (req: any, res: any) => {
  try {
    const db = getDb();
    const { reason, email } = req.body;
    const userId = req.user.uid;
    
    // Prevent guest accounts from requesting deletion
    const isGuest = req.headers['x-is-guest'] === 'true';
    if (isGuest) {
      return res.status(403).json({ error: 'Guest accounts cannot request deletion' });
    }
    if (req.headers['x-user-role'] !== 'admin') {
      return res.status(403).json({ error: 'Team member accounts must be removed by their company admin' });
    }

    const requestRef = await addDoc(collection(db, 'accountDeletionRequests'), {
      userId,
      email: email || 'unknown@user.com',
      tenantId: 'default',
      requestedAt: serverTimestamp(),
      requestedBy: userId,
      reason: reason || '',
      status: 'pending'
    });

    await addDoc(collection(db, 'auditLogs'), {
      action: 'deletion_requested',
      actorUserId: userId,
      targetUserId: userId,
      tenantId: 'default',
      timestamp: serverTimestamp(),
      metadata: { reason, requestId: requestRef.id }
    });

    res.json({ success: true, requestId: requestRef.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Cancel Deletion Request
accountRouter.post('/api/account/delete-request/cancel', checkAuth, async (req: any, res: any) => {
  try {
    const db = getDb();
    const userId = req.user.uid;
    
    const q = query(collection(db, 'accountDeletionRequests'), where('userId', '==', userId), where('status', '==', 'pending'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'No pending request found' });
    }

    const requestDoc = snapshot.docs[0];
    await updateDoc(doc(db, 'accountDeletionRequests', requestDoc.id), {
      status: 'cancelled'
    });

    await addDoc(collection(db, 'auditLogs'), {
      action: 'deletion_cancelled',
      actorUserId: userId,
      targetUserId: userId,
      tenantId: 'default',
      timestamp: serverTimestamp(),
      metadata: { requestId: requestDoc.id }
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

accountRouter.post('/api/integration-requests', checkAuth, async (req: any, res: any) => {
  try {
    const db = getDb();
    const userId = req.user.uid;
    const companyId = String(req.body.companyId || req.headers['x-company-id'] || '').trim() || 'unknown';
    const email = String(req.body.email || req.headers['x-user-email'] || '').trim().toLowerCase();
    const integrationName = String(req.body.integrationName || '').trim();
    const message = String(req.body.message || '').trim();
    const requestType = req.body.requestType === 'support' ? 'support' : 'integration';

    if (!integrationName && requestType === 'integration') {
      return res.status(400).json({ error: 'Tell us which integration you need.' });
    }
    if (!message || message.length < 8) {
      return res.status(400).json({ error: 'Please add a short description.' });
    }

    const payload = {
      requestType,
      integrationName: integrationName || 'Support request',
      message,
      status: 'pending',
      userId,
      email: email || null,
      companyId,
      companyName: req.body.companyName || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const requestRef = await addDoc(collection(db, 'integrationRequests'), payload);
    await addDoc(collection(db, 'auditLogs'), {
      action: requestType === 'support' ? 'support_request_created' : 'integration_request_created',
      actorUserId: userId,
      tenantId: companyId,
      timestamp: serverTimestamp(),
      metadata: { requestId: requestRef.id, integrationName: payload.integrationName },
    }).catch(() => {});

    res.json({ success: true, id: requestRef.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

accountRouter.post('/api/support/tickets', checkAuth, async (req: any, res: any) => {
  try {
    const db = getDb();
    const userId = req.user.uid;
    const companyId = String(req.body.companyId || req.headers['x-company-id'] || '').trim() || 'unknown';
    const subject = textField(req.body.subject, 140);
    const message = String(req.body.message || '').trim().slice(0, 4000);
    const priority = ['normal', 'urgent'].includes(req.body.priority) ? req.body.priority : 'normal';
    const email = String(req.body.email || req.headers['x-user-email'] || '').trim().toLowerCase();

    if (!subject || subject.length < 3) return res.status(400).json({ error: 'Support subject is required.' });
    if (!message || message.length < 8) return res.status(400).json({ error: 'Please add a support message.' });

    const payload = {
      subject,
      message,
      priority,
      status: 'open',
      companyId,
      companyName: req.body.companyName || null,
      userId,
      email: email || null,
      lastReplyFrom: 'user',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ticketRef = await addDoc(collection(db, 'supportTickets'), payload);
    await addDoc(collection(db, 'supportTickets', ticketRef.id, 'replies'), {
      body: message,
      authorType: 'user',
      authorUserId: userId,
      authorEmail: email || null,
      createdAt: serverTimestamp(),
    });
    res.json({ success: true, id: ticketRef.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create support ticket' });
  }
});

accountRouter.get('/api/support/tickets', checkAuth, async (req: any, res: any) => {
  try {
    const db = getDb();
    const companyId = String(req.headers['x-company-id'] || req.query.companyId || '').trim();
    if (!companyId) return res.status(400).json({ error: 'Missing company ID' });
    const q = query(collection(db, 'supportTickets'), where('companyId', '==', companyId), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    const tickets = await Promise.all(snapshot.docs.map(async (ticketDoc) => {
      const repliesSnap = await getDocs(query(collection(db, 'supportTickets', ticketDoc.id, 'replies'), orderBy('createdAt', 'asc'))).catch(() => ({ docs: [] } as any));
      return {
        id: ticketDoc.id,
        ...ticketDoc.data(),
        replies: repliesSnap.docs.map((replyDoc: any) => ({ id: replyDoc.id, ...replyDoc.data() })),
      };
    }));
    res.json({ tickets });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load support tickets' });
  }
});

accountRouter.get('/api/admin/integration-requests', checkAuth, checkAdmin, async (_req: any, res: any) => {
  try {
    const db = getDb();
    const q = query(collection(db, 'integrationRequests'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    res.json({ requests: snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

accountRouter.post('/api/admin/integration-requests/:id/status', checkAuth, checkAdmin, async (req: any, res: any) => {
  try {
    const db = getDb();
    const status = ['pending', 'reviewing', 'completed', 'declined'].includes(req.body.status)
      ? req.body.status
      : 'reviewing';
    await updateDoc(doc(db, 'integrationRequests', req.params.id), {
      status,
      adminNotes: String(req.body.adminNotes || '').trim(),
      reviewedBy: req.user.uid,
      updatedAt: serverTimestamp(),
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

accountRouter.get('/api/app-admin/portal-summary', checkAuth, checkAppAdmin, async (_req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const [companiesSnap, integrationRequestsSnap, smsSenderRequestsSnap, smsReplyNumberRequestsSnap, supportTicketsSnap] = await Promise.all([
      db.collection('companies').limit(200).get(),
      db.collection('integrationRequests').orderBy('createdAt', 'desc').limit(100).get().catch(() => db.collection('integrationRequests').limit(100).get()),
      db.collection('smsSenderRequests').orderBy('requestedAt', 'desc').limit(100).get().catch(() => db.collection('smsSenderRequests').limit(100).get()),
      db.collection('smsReplyNumberRequests').orderBy('requestedAt', 'desc').limit(100).get().catch(() => db.collection('smsReplyNumberRequests').limit(100).get()),
      db.collection('supportTickets').orderBy('updatedAt', 'desc').limit(100).get().catch(() => db.collection('supportTickets').limit(100).get()),
    ]);

    const companies = await Promise.all(companiesSnap.docs.map(async (companyDoc: any) => {
      const [usersSnap, integrationsSnap] = await Promise.all([
        companyDoc.ref.collection('users').limit(100).get().catch(() => ({ size: 0 })),
        companyDoc.ref.collection('settings').doc('integrations').get().catch(() => null),
      ]);
      const data = companyDoc.data() || {};
      const integrations = integrationsSnap?.exists ? integrationsSnap.data() : {};
      return {
        id: companyDoc.id,
        companyName: data.companyName || data.name || companyDoc.id,
        subscriptionPlan: data.subscriptionPlan || null,
        subscriptionStatus: data.subscriptionStatus || null,
        subscriptionActive: Boolean(data.subscriptionActive),
        billingOwnerUid: data.billingOwnerUid || null,
        userCount: usersSnap.size || 0,
        smsSenderStatus: integrations?.smsSenderStatus || 'not_started',
        smsSenderRequestedId: integrations?.smsSenderRequestedId || '',
        smsSenderApprovedId: integrations?.smsSenderApprovedId || '',
        smsReplyNumberStatus: integrations?.smsReplyNumberStatus || 'not_started',
        smsReplyNumberAssigned: integrations?.smsReplyNumberAssigned || '',
      };
    }));

    res.json({
      companies,
      integrationRequests: integrationRequestsSnap.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() })),
      smsSenderRequests: smsSenderRequestsSnap.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() })),
      smsReplyNumberRequests: smsReplyNumberRequestsSnap.docs.map((docSnap: any) => ({ id: docSnap.id, ...docSnap.data() })),
      supportTickets: await Promise.all(supportTicketsSnap.docs.map(async (docSnap: any) => {
        const repliesSnap = await docSnap.ref.collection('replies').orderBy('createdAt', 'asc').limit(100).get().catch(() => ({ docs: [] }));
        return {
          id: docSnap.id,
          ...docSnap.data(),
          replies: repliesSnap.docs.map((replyDoc: any) => ({ id: replyDoc.id, ...replyDoc.data() })),
        };
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load app admin portal' });
  }
});

accountRouter.post('/api/app-admin/sms-reply-number-requests/:id/status', checkAuth, checkAppAdmin, async (req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const status = ['pending', 'reviewing', 'active', 'rejected'].includes(req.body.status)
      ? req.body.status
      : 'reviewing';
    const assignedNumber = textField(req.body.assignedNumber, 40);
    const requestRef = db.collection('smsReplyNumberRequests').doc(req.params.id);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) return res.status(404).json({ error: 'Reply number request not found' });

    const request = requestSnap.data() || {};
    const companyId = String(request.companyId || '').trim();
    if (!companyId) return res.status(400).json({ error: 'Reply number request is missing company ID' });
    if (status === 'active' && assignedNumber.length < 8) {
      return res.status(400).json({ error: 'Assigned reply number is required to activate two-way replies.' });
    }

    await requestRef.set({
      status,
      assignedNumber: status === 'active' ? assignedNumber : '',
      adminNotes: textField(req.body.adminNotes, 500),
      reviewedBy: req.user.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('companies').doc(companyId).collection('settings').doc('integrations').set({
      smsReplyNumberStatus: status,
      smsReplyNumberAssigned: status === 'active' ? assignedNumber : '',
      smsReplyNumberReviewedBy: req.user.uid,
      smsReplyNumberReviewedAt: FieldValue.serverTimestamp(),
      smsReplyNumberAdminNotes: textField(req.body.adminNotes, 500),
    }, { merge: true });

    await db.collection('companies').doc(companyId).collection('audit_logs').add({
      action: status === 'active' ? 'SMS_REPLY_NUMBER_ACTIVATED' : 'SMS_REPLY_NUMBER_STATUS_UPDATED',
      actorUserId: req.user.uid,
      assignedNumber: status === 'active' ? assignedNumber : null,
      status,
      requestId: req.params.id,
      timestamp: FieldValue.serverTimestamp(),
    }).catch(() => {});

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update reply number request' });
  }
});

accountRouter.post('/api/app-admin/support-tickets/:id/replies', checkAuth, checkAppAdmin, async (req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const body = String(req.body.body || '').trim().slice(0, 4000);
    const status = ['open', 'waiting', 'resolved'].includes(req.body.status) ? req.body.status : 'waiting';
    if (body.length < 2) return res.status(400).json({ error: 'Reply message is required.' });

    const ticketRef = db.collection('supportTickets').doc(req.params.id);
    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) return res.status(404).json({ error: 'Support ticket not found' });

    await ticketRef.collection('replies').add({
      body,
      authorType: 'admin',
      authorUserId: req.user.uid,
      authorEmail: textField(req.headers['x-user-email'], 160).toLowerCase(),
      createdAt: FieldValue.serverTimestamp(),
    });
    await ticketRef.set({
      status,
      lastReplyFrom: 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to reply to support ticket' });
  }
});

accountRouter.post('/api/app-admin/companies/:companyId/admins', checkAuth, checkAppAdmin, async (req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const companyId = String(req.params.companyId || '').trim();
    const email = textField(req.body.email, 160).toLowerCase();
    const displayName = textField(req.body.displayName, 120);
    if (!companyId) return res.status(400).json({ error: 'Missing company ID' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

    const companySnap = await db.collection('companies').doc(companyId).get();
    const companyName = companySnap.exists
      ? (companySnap.data()?.companyName || companySnap.data()?.name || null)
      : null;
    const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
    const uid = userSnap.docs[0]?.id || null;
    const profile = {
      uid,
      email,
      displayName: displayName || null,
      companyId,
      companyName,
      role: 'admin',
      permissions: ['admin'],
      hasAccess: true,
      billingRequired: false,
      subscriptionActive: true,
      subscriptionStatus: 'active',
      subscriptionSource: 'company_admin_assignment',
      authMethod: req.body.authMethod || 'google',
      invitedBy: req.user.uid,
      invitedByEmail: textField(req.headers['x-user-email'], 160).toLowerCase(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await Promise.all([
      db.collection('team_invites').doc(email).set({
        ...profile,
        addedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      db.collection('companies').doc(companyId).collection('users').doc(email).set({
        ...profile,
        addedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      uid
        ? db.collection('companies').doc(companyId).collection('users').doc(uid).set({
            ...profile,
            uid,
            linkedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        : Promise.resolve(),
      uid
        ? db.collection('users').doc(uid).set({
            ...profile,
            uid,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        : Promise.resolve(),
      db.collection('companies').doc(companyId).collection('audit_logs').add({
        action: 'APP_ADMIN_ASSIGNED_COMPANY_ADMIN',
        actorUserId: req.user.uid,
        targetEmail: email,
        targetUid: uid,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {}),
    ]);

    res.json({ success: true, uid, email, companyId });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to assign company admin' });
  }
});

accountRouter.post('/api/app-admin/sms-sender-requests/:id/status', checkAuth, checkAppAdmin, async (req: any, res: any) => {
  try {
    const db = getProvisioningDb();
    const status = ['pending', 'reviewing', 'active', 'rejected'].includes(req.body.status)
      ? req.body.status
      : 'reviewing';
    const approvedSenderId = normalizeSenderId(req.body.approvedSenderId || req.body.senderId || '');
    const requestRef = db.collection('smsSenderRequests').doc(req.params.id);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) return res.status(404).json({ error: 'Sender ID request not found' });

    const request = requestSnap.data() || {};
    const companyId = String(request.companyId || '').trim();
    if (!companyId) return res.status(400).json({ error: 'Sender ID request is missing company ID' });
    if (status === 'active' && approvedSenderId.length < 3) {
      return res.status(400).json({ error: 'Approved Sender ID is required to activate SMS.' });
    }

    const update = {
      status,
      approvedSenderId: status === 'active' ? approvedSenderId : '',
      adminNotes: textField(req.body.adminNotes, 500),
      reviewedBy: req.user.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await requestRef.set(update, { merge: true });

    const integrationPatch = {
      smsSenderStatus: status,
      smsSenderApprovedId: status === 'active' ? approvedSenderId : '',
      mobileMessageSenderId: status === 'active' ? approvedSenderId : '',
      mobileMessageEnabled: status === 'active',
      smsRelayEnabled: status === 'active',
      maxotelEnabled: status === 'active',
      managedMessagingEnabled: true,
      managedMessagingProvider: 'repairsync_company_messaging',
      smsSenderReviewedBy: req.user.uid,
      smsSenderReviewedAt: FieldValue.serverTimestamp(),
      smsSenderAdminNotes: textField(req.body.adminNotes, 500),
    };
    await db.collection('companies').doc(companyId).collection('settings').doc('integrations').set(integrationPatch, { merge: true });
    await db.collection('companies').doc(companyId).collection('audit_logs').add({
      action: status === 'active' ? 'SMS_SENDER_ID_ACTIVATED' : 'SMS_SENDER_ID_STATUS_UPDATED',
      actorUserId: req.user.uid,
      senderId: approvedSenderId || request.registration?.senderId || null,
      status,
      requestId: req.params.id,
      timestamp: FieldValue.serverTimestamp(),
    }).catch(() => {});

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update sender request' });
  }
});

// 3. Admin: View Pending Requests
accountRouter.get('/api/admin/account-deletion-requests', checkAuth, checkAdmin, async (req: any, res: any) => {
  try {
    const db = getDb();
    const q = query(collection(db, 'accountDeletionRequests'), orderBy('requestedAt', 'desc'));
    const snapshot = await getDocs(q);
    
    const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ requests });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Admin: Approve Deletion
accountRouter.post('/api/admin/account-deletion-requests/:id/approve', checkAuth, checkAdmin, async (req: any, res: any) => {
  try {
    const db = getDb();
    const requestId = req.params.id;
    const { adminNotes } = req.body;
    const adminId = req.user.uid;

    const requestRef = doc(db, 'accountDeletionRequests', requestId);
    const requestSnap = await getDoc(requestRef);
    if (!requestSnap.exists()) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const requestData = requestSnap.data();

    // 1. Mark request as approved
    await updateDoc(requestRef, {
      status: 'approved',
      reviewedBy: adminId,
      reviewedAt: serverTimestamp(),
      adminNotes: adminNotes || ''
    });

    // 2. Anonymize user records/disable access (Mocking this due to client-sdk limitations)
    // In a real app we'd use admin.auth().deleteUser()
    const targetUserId = requestData.userId;
    
    await updateDoc(doc(db, 'users', targetUserId), {
      hasAccess: false,
      accountDeletionStatus: 'approved',
      email: `deleted_${targetUserId}@anonymized.app`,
      displayName: 'Deleted User'
    });

    await addDoc(collection(db, 'auditLogs'), {
      action: 'deletion_approved',
      actorUserId: adminId,
      targetUserId,
      tenantId: requestData.tenantId || 'default',
      timestamp: serverTimestamp(),
      metadata: { requestId, adminNotes }
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Admin: Reject Deletion
accountRouter.post('/api/admin/account-deletion-requests/:id/reject', checkAuth, checkAdmin, async (req: any, res: any) => {
  try {
    const db = getDb();
    const requestId = req.params.id;
    const { adminNotes } = req.body;
    const adminId = req.user.uid;

    const requestRef = doc(db, 'accountDeletionRequests', requestId);
    const requestSnap = await getDoc(requestRef);
    
    if (!requestSnap.exists()) {
      return res.status(404).json({ error: 'Request not found' });
    }

    await updateDoc(requestRef, {
      status: 'rejected',
      reviewedBy: adminId,
      reviewedAt: serverTimestamp(),
      adminNotes: adminNotes || ''
    });

    const targetUserId = requestSnap.data().userId;

    await addDoc(collection(db, 'auditLogs'), {
      action: 'deletion_rejected',
      actorUserId: adminId,
      targetUserId,
      tenantId: 'default',
      timestamp: serverTimestamp(),
      metadata: { requestId, adminNotes }
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
