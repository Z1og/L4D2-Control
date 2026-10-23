#pragma semicolon 1
#pragma newdecls required
#include <sourcemod>

public Plugin myinfo = {
    name = "L4D2 Control Players", author = "L4D2-Control",
    description = "Private player identity, permissions, moderation and admission whitelist",
    version = "1.4.0", url = ""
};
KeyValues gHistory;
char gSnapshotPath[PLATFORM_MAX_PATH];
char gHistoryPath[PLATFORM_MAX_PATH];
bool gHistoryDirty;
int gLastSave;
KeyValues gBans;
char gBansPath[PLATFORM_MAX_PATH];
KeyValues gWhitelist;
char gWhitelistPath[PLATFORM_MAX_PATH];
bool gWhitelistEnabled;
bool gAdminCheckComplete[MAXPLAYERS + 1];

public void OnPluginStart() {
    char privateDir[PLATFORM_MAX_PATH];
    BuildPath(Path_SM, privateDir, sizeof(privateDir), "data/l4d2 control");
    int privateMode = FPERM_U_READ | FPERM_U_WRITE | FPERM_U_EXEC;
    if (!DirExists(privateDir) && !CreateDirectory(privateDir, privateMode)) SetFailState("Cannot create private player data directory");
    if (!SetFilePermissions(privateDir, privateMode)) SetFailState("Cannot protect private player data directory");
    BuildPath(Path_SM, gSnapshotPath, sizeof(gSnapshotPath), "data/l4d2 control/players.txt");
    BuildPath(Path_SM, gHistoryPath, sizeof(gHistoryPath), "data/l4d2 control/history.txt");
    BuildPath(Path_SM, gBansPath, sizeof(gBansPath), "data/l4d2 control/bans.txt");
    BuildPath(Path_SM, gWhitelistPath, sizeof(gWhitelistPath), "data/l4d2 control/whitelist.txt");
    if (!LoadBans()) SetFailState("Cannot read panel bans; preserving original file");
    if (!LoadWhitelist()) SetFailState("Cannot read panel whitelist; preserving original file");
    gHistory = new KeyValues("PanelPlayerHistory");
    gHistory.SetEscapeSequences(true);
    if (FileExists(gHistoryPath) && !gHistory.ImportFromFile(gHistoryPath)) SetFailState("Player history cannot be read; preserving the original file");
    RegServerCmd("l4d2_control_players", CommandSnapshot);
    RegServerCmd("l4d2_control_bans", CommandBans);
    RegServerCmd("l4d2_control_whitelist", CommandWhitelist);
    RegServerCmd("l4d2_control_kick", CommandKick);
    CreateTimer(5.0, TimerSnapshot, _, TIMER_REPEAT);
    CreateTimer(1.0, TimerEnforceWhitelist, _, TIMER_REPEAT);
    for (int client = 1; client <= MaxClients; client++) if (IsClientInGame(client) && !IsFakeClient(client)) { gAdminCheckComplete[client] = true; Remember(client); }
    EnforceBans(); WriteSnapshot(); SaveHistory();
}
public void OnClientPostAdminCheck(int client) { gAdminCheckComplete[client] = true; Remember(client); EnforceBan(client); EnforceWhitelist(client); WriteSnapshot(); SaveHistory(); }
public void OnClientDisconnect(int client) { Remember(client); SaveHistory(); }
public void OnClientDisconnect_Post(int client) { gAdminCheckComplete[client] = false; WriteSnapshot(); }
public void OnPluginEnd() { SaveHistory(); if (FileExists(gSnapshotPath)) DeleteFile(gSnapshotPath); delete gWhitelist; }
public void OnMapEnd() { SaveHistory(); }

void Remember(int client) {
    if (!IsClientConnected(client) || IsFakeClient(client) || !IsClientAuthorized(client)) return;
    char steam2[32], name[MAX_NAME_LENGTH];
    if (!GetClientAuthId(client, AuthId_Steam2, steam2, sizeof(steam2), true)) return;
    GetClientName(client, name, sizeof(name));
    gHistory.Rewind(); gHistory.JumpToKey(steam2, true);
    if (!gHistory.GetNum("firstSeen")) gHistory.SetNum("firstSeen", GetTime());
    gHistory.SetNum("lastSeen", GetTime()); gHistory.SetString("name", name);
    char address[64]; if (GetClientIP(client, address, sizeof(address), true)) gHistory.SetString("ip", address);
    gHistory.Rewind(); gHistoryDirty = true;
}
bool ExportAtomic(KeyValues kv, const char[] destination) {
    char temp[PLATFORM_MAX_PATH]; Format(temp, sizeof(temp), "%s.new", destination);
    kv.Rewind(); if (!kv.ExportToFile(temp)) return false;
    if (!SetFilePermissions(temp, FPERM_U_READ | FPERM_U_WRITE)) return false;
    return RenameFile(destination, temp);
}
void SaveHistory() {
    gHistory.Rewind();
    if (gHistory.GotoFirstSubKey()) {
        do { if (GetTime() - gHistory.GetNum("lastSeen") > 2592000 && gHistory.DeleteKey("ip")) gHistoryDirty = true; } while (gHistory.GotoNextKey());
    }
    gHistory.Rewind();
    if (gHistoryDirty && ExportAtomic(gHistory, gHistoryPath)) { gHistoryDirty = false; gLastSave = GetTime(); }
}
bool WriteSnapshot() {
    KeyValues snapshot = new KeyValues("PanelPlayers");
    snapshot.SetEscapeSequences(true);
    snapshot.SetNum("version", 1); snapshot.SetNum("updated", GetTime());
    snapshot.SetNum("moderationVersion", 1);
    snapshot.SetNum("whitelistVersion", 1);
    int bots;
    for (int client = 1; client <= MaxClients; client++) if (IsClientInGame(client) && IsFakeClient(client)) bots++;
    snapshot.SetNum("bots", bots); snapshot.JumpToKey("players", true);
    for (int client = 1; client <= MaxClients; client++) {
        if (!IsClientInGame(client) || IsFakeClient(client) || !IsClientAuthorized(client)) continue;
        char steam2[32], steam64[32], name[MAX_NAME_LENGTH], key[16], flags[32];
        if (!GetClientAuthId(client, AuthId_Steam2, steam2, sizeof(steam2), true) || !GetClientAuthId(client, AuthId_SteamID64, steam64, sizeof(steam64), true)) continue;
        IntToString(GetClientUserId(client), key, sizeof(key)); GetClientName(client, name, sizeof(name));
        FlagBitsToString(GetUserFlagBits(client), flags, sizeof(flags));
        snapshot.JumpToKey(key, true);
        char address[64]; if (GetClientIP(client, address, sizeof(address), true)) snapshot.SetString("ip", address);
        snapshot.SetString("steam2", steam2); snapshot.SetString("steam64", steam64); snapshot.SetString("name", name);
        snapshot.SetNum("userid", GetClientUserId(client)); snapshot.SetNum("team", GetClientTeam(client));
        snapshot.SetNum("ping", RoundToNearest(GetClientAvgLatency(client, NetFlow_Both) * 1000.0));
        snapshot.SetNum("connected", RoundToFloor(GetClientTime(client))); snapshot.SetString("flags", flags);
        AdminId admin = GetUserAdmin(client); snapshot.SetNum("immunity", admin == INVALID_ADMIN_ID ? 0 : GetAdminImmunityLevel(admin));
        snapshot.GoBack(); Remember(client);
    }
    bool written = ExportAtomic(snapshot, gSnapshotPath);
    if (!written) LogError("Unable to write player snapshot");
    delete snapshot;
    return written;
}
public Action TimerSnapshot(Handle timer) { EnforceWhitelists(); WriteSnapshot(); if (GetTime() - gLastSave >= 60) SaveHistory(); return Plugin_Continue; }
public Action CommandSnapshot(int args) {
    char nonce[40]; GetCmdArg(1, nonce, sizeof(nonce));
    bool written = WriteSnapshot(); SaveHistory();
    if (written) PrintToServer("L4D2CONTROL_SNAPSHOT %s", nonce);
    else PrintToServer("L4D2CONTROL_ERROR snapshot write failed");
    return Plugin_Handled;
}

bool LoadBans() {
    KeyValues next = new KeyValues("PanelBans");
    next.SetEscapeSequences(true);
    if (FileExists(gBansPath) && (!next.ImportFromFile(gBansPath) || next.GetNum("version") != 1)) { delete next; return false; }
    delete gBans; gBans = next;
    return true;
}
bool ActiveBan(int client) {
    if (!gBans || !IsClientConnected(client) || IsFakeClient(client) || !IsClientAuthorized(client)) return false;
    char steam2[32], expiry[32], current[32];
    if (!GetClientAuthId(client, AuthId_Steam2, steam2, sizeof(steam2), true)) return false;
    if (steam2[6] == '0') steam2[6] = '1';
    gBans.Rewind();
    bool found = gBans.JumpToKey("bans") && gBans.JumpToKey(steam2);
    if (found) gBans.GetString("expires", expiry, sizeof(expiry));
    gBans.Rewind();
    if (!found || !expiry[0]) return false;
    IntToString(GetTime(), current, sizeof(current));
    // Decimal comparison avoids overflowing a long-duration expiry timestamp.
    return strlen(expiry) > strlen(current) || (strlen(expiry) == strlen(current) && strcmp(expiry, current) > 0);
}
void EnforceBan(int client) {
    if (ActiveBan(client) && !IsClientInKickQueue(client)) KickClient(client, "You are banned from this server. Contact the server administrator.");
}
void EnforceBans() { for (int client = 1; client <= MaxClients; client++) EnforceBan(client); }
public void OnClientAuthorized(int client, const char[] auth) { EnforceBan(client); }
public Action CommandBans(int args) {
    char expected[40], revision[40]; GetCmdArg(1, expected, sizeof(expected));
    if (!LoadBans()) { PrintToServer("L4D2CONTROL_BANS_ERROR %s", expected); return Plugin_Handled; }
    gBans.Rewind(); gBans.GetString("revision", revision, sizeof(revision));
    if (!StrEqual(expected, revision)) { PrintToServer("L4D2CONTROL_BANS_ERROR %s", expected); return Plugin_Handled; }
    EnforceBans();
    PrintToServer("L4D2CONTROL_BANS %s", revision);
    return Plugin_Handled;
}
bool LoadWhitelist() {
    KeyValues next = new KeyValues("PanelWhitelist");
    next.SetEscapeSequences(true);
    if (!FileExists(gWhitelistPath)) {
        next.SetNum("version", 1); next.SetNum("enabled", 0); next.SetString("revision", "000000000000000000000000");
    } else if (!next.ImportFromFile(gWhitelistPath) || next.GetNum("version") != 1 || next.GetNum("enabled", -1) < 0 || next.GetNum("enabled", -1) > 1) {
        delete next; return false;
    }
    gWhitelistEnabled = next.GetNum("enabled") == 1;
    delete gWhitelist; gWhitelist = next;
    return true;
}
bool Whitelisted(int client) {
    if (!gWhitelistEnabled || !gWhitelist || !gAdminCheckComplete[client] || !IsClientConnected(client) || IsFakeClient(client) || !IsClientAuthorized(client)) return false;
    // Any SourceMod administrator is implicitly allowed. The panel also materializes
    // known administrators into the durable list when whitelist mode is enabled.
    if (GetUserAdmin(client) != INVALID_ADMIN_ID) return true;
    char steam2[32];
    if (!GetClientAuthId(client, AuthId_Steam2, steam2, sizeof(steam2), true)) return false;
    if (steam2[6] == '0') steam2[6] = '1';
    gWhitelist.Rewind();
    bool found = gWhitelist.JumpToKey("players") && gWhitelist.JumpToKey(steam2);
    gWhitelist.Rewind();
    return found;
}
void EnforceWhitelist(int client) {
    if (gWhitelistEnabled && gAdminCheckComplete[client] && !Whitelisted(client) && IsClientConnected(client) && !IsFakeClient(client) && IsClientAuthorized(client) && !IsClientInKickQueue(client)) {
        KickClient(client, "This server requires an approved player whitelist entry.");
    }
}
void EnforceWhitelists() { for (int client = 1; client <= MaxClients; client++) EnforceWhitelist(client); }
public Action TimerEnforceWhitelist(Handle timer) { EnforceWhitelists(); return Plugin_Continue; }
public Action CommandWhitelist(int args) {
    char expected[40], revision[40]; GetCmdArg(1, expected, sizeof(expected));
    if (!LoadWhitelist()) { PrintToServer("L4D2CONTROL_WHITELIST_ERROR %s", expected); return Plugin_Handled; }
    gWhitelist.Rewind(); gWhitelist.GetString("revision", revision, sizeof(revision));
    if (!StrEqual(expected, revision)) { PrintToServer("L4D2CONTROL_WHITELIST_ERROR %s", expected); return Plugin_Handled; }
    EnforceWhitelists();
    PrintToServer("L4D2CONTROL_WHITELIST %s", revision);
    return Plugin_Handled;
}
public Action CommandKick(int args) {
    char nonce[40], expected[32], userid[16], actual[32];
    GetCmdArg(1, nonce, sizeof(nonce)); GetCmdArg(2, expected, sizeof(expected)); GetCmdArg(3, userid, sizeof(userid));
    int client = GetClientOfUserId(StringToInt(userid));
    if (client <= 0 || !IsClientInGame(client) || IsFakeClient(client) || !GetClientAuthId(client, AuthId_SteamID64, actual, sizeof(actual), true) || !StrEqual(actual, expected)) {
        PrintToServer("L4D2CONTROL_KICK_OFFLINE %s", nonce); return Plugin_Handled;
    }
    Remember(client); SaveHistory();
    KickClient(client, "You were kicked by the server administrator.");
    PrintToServer("L4D2CONTROL_KICK %s", nonce);
    return Plugin_Handled;
}

// Only panel-managed, validated values are restored after map configs execute.
public void OnConfigsExecuted() {
    char file[PLATFORM_MAX_PATH]; BuildPath(Path_SM, file, sizeof(file), "data/l4d2 control/gameplay.txt");
    if (!FileExists(file)) return;
    KeyValues kv = new KeyValues("PanelGameplay");
    if (!kv.ImportFromFile(file)) { delete kv; LogError("Invalid panel gameplay settings"); return; }
    char mode[32], difficulty[24]; kv.GetString("mp_gamemode", mode, sizeof(mode)); kv.GetString("z_difficulty", difficulty, sizeof(difficulty));
    bool coop = StrEqual(mode, "coop") || StrEqual(mode, "realism");
    bool validMode = coop || StrEqual(mode, "versus") || StrEqual(mode, "survival") || StrEqual(mode, "scavenge");
    bool validDifficulty = StrEqual(difficulty, "Easy") || StrEqual(difficulty, "Normal") || StrEqual(difficulty, "Hard") || StrEqual(difficulty, "Impossible");
    int lobby = kv.GetNum("sv_allow_lobby_connect_only", -1), slots = kv.GetNum("sv_maxplayers", 0), bots = kv.GetNum("bots_limit", 0), join = kv.GetNum("bots_join_limit", -1);
    if (!validMode || !validDifficulty || lobby < 0 || lobby > 1 || (slots && (slots < 4 || slots > MaxClients)) || (bots && (bots < 1 || bots > slots)) || join < -1 || join > MaxClients) { delete kv; LogError("Panel gameplay settings outside supported limits"); return; }
    char names[][] = {"mp_gamemode", "z_difficulty", "sv_allow_lobby_connect_only", "sv_maxplayers", "sv_visiblemaxplayers", "bots_limit", "bots_join_limit"};
    for (int i = 0; i < sizeof(names); i++) {
        char value[32]; kv.GetString(names[i], value, sizeof(value)); if (!value[0]) continue;
        ConVar setting = FindConVar(names[i]); if (setting == null) { LogError("Missing gameplay convar: %s", names[i]); delete kv; return; }
    }
    for (int i = 0; i < sizeof(names); i++) {
        char value[32]; kv.GetString(names[i], value, sizeof(value)); if (!value[0]) continue;
        ConVar setting = FindConVar(names[i]); setting.SetString(value);
    }
    delete kv;
}
