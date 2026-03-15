import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ArrowLeft, RefreshCw, Users, ListTodo, CalendarDays, CalendarRange, CalendarClock, LayoutList, CalendarIcon, Activity, Shield, Trash2, Plus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type StatsSummary = {
  total_users: number;
  total_todos: number;
  todos_today_count: number;
  todos_this_week_count: number;
  todos_next_week_count: number;
  todos_others_count: number;
  computed_at: string;
};

type DailyStat = {
  stat_date: string;
  unique_users: number;
  todos_created: number;
  todos_completed: number;
};

type LatencyStat = {
  function_name: string;
  action: string;
  call_count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

type LatencyTimeseries = {
  bucket: string;
  function_name: string;
  avg_ms: number;
  p95_ms: number;
  call_count: number;
};

async function invokeAdmin(action: string, extra?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-api", { body: { action, ...extra } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function Admin() {
  const { isAdmin, isLoading } = useAdminCheck();
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [daily, setDaily] = useState<DailyStat[]>([]);
  const [latencyStats, setLatencyStats] = useState<LatencyStat[]>([]);
  const [latencyTs, setLatencyTs] = useState<LatencyTimeseries[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date>(subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState<Date>(new Date());
  const { toast } = useToast();

  const fetchStats = async () => {
    const [summaryData, dailyData] = await Promise.all([
      invokeAdmin("get_summary"),
      invokeAdmin("get_daily"),
    ]);
    if (summaryData) setSummary(summaryData as StatsSummary);
    if (dailyData) setDaily(dailyData as DailyStat[]);
  };

  const fetchLatency = async () => {
    const df = format(dateFrom, "yyyy-MM-dd");
    const dt = format(dateTo, "yyyy-MM-dd");
    const [stats, ts] = await Promise.all([
      invokeAdmin("get_latency_stats", { date_from: df, date_to: dt }),
      invokeAdmin("get_latency_timeseries", { date_from: df, date_to: dt, granularity: "daily" }),
    ]);
    if (stats) setLatencyStats(stats as LatencyStat[]);
    if (ts) setLatencyTs(ts as LatencyTimeseries[]);
  };

  useEffect(() => {
    if (isAdmin) fetchStats();
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) fetchLatency();
  }, [isAdmin, dateFrom, dateTo]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await invokeAdmin("refresh");
      await Promise.all([fetchStats(), fetchLatency()]);
      toast({ title: "Stats refreshed" });
    } catch (e: any) {
      toast({ title: "Error refreshing stats", description: e.message, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const chartDaily = useMemo(() => {
    const from = format(dateFrom, "yyyy-MM-dd");
    const to = format(dateTo, "yyyy-MM-dd");
    return daily
      .filter((d) => d.stat_date >= from && d.stat_date <= to)
      .map((d) => ({
        ...d,
        date: new Date(d.stat_date).toLocaleDateString("en", { month: "short", day: "numeric" }),
      }));
  }, [daily, dateFrom, dateTo]);

  const latencyChartData = useMemo(() => {
    // Group timeseries by bucket, with one p95 line per function
    const bucketMap = new Map<string, Record<string, number>>();
    for (const row of latencyTs) {
      const label = new Date(row.bucket).toLocaleDateString("en", { month: "short", day: "numeric" });
      if (!bucketMap.has(label)) bucketMap.set(label, { date: 0 } as any);
      const entry = bucketMap.get(label)!;
      entry.date = label as any;
      entry[`${row.function_name}_p95`] = row.p95_ms;
      entry[`${row.function_name}_avg`] = row.avg_ms;
    }
    return Array.from(bucketMap.values());
  }, [latencyTs]);

  const functionNames = useMemo(() => {
    const names = new Set(latencyTs.map((r) => r.function_name));
    return Array.from(names).sort();
  }, [latencyTs]);

  const FUNCTION_COLORS: Record<string, string> = {
    "todos-api": "hsl(var(--primary))",
    "user-api": "hsl(var(--accent))",
    "images-api": "hsl(142 76% 36%)",
    "admin-api": "hsl(38 92% 50%)",
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAdmin) return null;

  const usersChartConfig = {
    unique_users: { label: "Unique Users", color: "hsl(var(--primary))" },
  };

  const todosChartConfig = {
    todos_created: { label: "Created", color: "hsl(var(--accent))" },
    todos_completed: { label: "Completed", color: "hsl(var(--primary))" },
  };

  const latencyChartConfig = Object.fromEntries(
    functionNames.map((fn) => [`${fn}_p95`, { label: `${fn} p95`, color: FUNCTION_COLORS[fn] || "hsl(var(--primary))" }])
  );

  const summaryCards = summary
    ? [
        { title: "Total Users", value: summary.total_users, icon: Users },
        { title: "Total Todos", value: summary.total_todos, icon: ListTodo },
        { title: "Today", value: summary.todos_today_count, icon: CalendarDays },
        { title: "This Week", value: summary.todos_this_week_count, icon: CalendarRange },
        { title: "Next Week", value: summary.todos_next_week_count, icon: CalendarClock },
        { title: "Others", value: summary.todos_others_count, icon: LayoutList },
      ]
    : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <h1 className="font-display text-xl font-bold">Admin Dashboard</h1>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Stats
          </Button>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {summary && (
          <p className="text-xs text-muted-foreground">
            Last computed: {new Date(summary.computed_at).toLocaleString()}
          </p>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {summaryCards.map((card) => (
            <Card key={card.title}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                <card.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Date range:</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="h-4 w-4 mr-1" />
                {format(dateFrom, "MMM d, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <span className="text-sm text-muted-foreground">to</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="h-4 w-4 mr-1" />
                {format(dateTo, "MMM d, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <div className="flex gap-1 ml-2">
            {[7, 14, 30, 90].map((days) => (
              <Button key={days} variant="ghost" size="sm" onClick={() => { setDateFrom(subDays(new Date(), days)); setDateTo(new Date()); }}>
                {days}d
              </Button>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Unique Users per Day</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={usersChartConfig} className="h-[300px] w-full">
              <BarChart data={chartDaily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} tickLine={false} />
                <YAxis fontSize={12} tickLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="unique_users" fill="var(--color-unique_users)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Todos Created vs Completed per Day</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={todosChartConfig} className="h-[300px] w-full">
              <LineChart data={chartDaily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} tickLine={false} />
                <YAxis fontSize={12} tickLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="todos_created" stroke="var(--color-todos_created)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="todos_completed" stroke="var(--color-todos_completed)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* API Latency Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">API Latency</h2>
            <span className="text-xs text-muted-foreground">(20% sampled)</span>
          </div>

          {latencyStats.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Latency by Function / Action</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-4">Function</th>
                      <th className="text-left py-2 pr-4">Action</th>
                      <th className="text-right py-2 pr-4">Calls</th>
                      <th className="text-right py-2 pr-4">Avg</th>
                      <th className="text-right py-2 pr-4">p50</th>
                      <th className="text-right py-2 pr-4">p95</th>
                      <th className="text-right py-2">p99</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latencyStats.map((row) => (
                      <tr key={`${row.function_name}-${row.action}`} className="border-b border-border/50">
                        <td className="py-2 pr-4 font-mono text-xs">{row.function_name}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{row.action}</td>
                        <td className="py-2 pr-4 text-right">{row.call_count}</td>
                        <td className="py-2 pr-4 text-right">{row.avg_ms}ms</td>
                        <td className="py-2 pr-4 text-right">{row.p50_ms}ms</td>
                        <td className="py-2 pr-4 text-right font-medium">{row.p95_ms}ms</td>
                        <td className="py-2 text-right">{row.p99_ms}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No latency data for the selected date range. Data will appear as API calls are made.
              </CardContent>
            </Card>
          )}

        {latencyChartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">p95 Latency Over Time (ms)</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={latencyChartConfig} className="h-[300px] w-full">
                  <LineChart data={latencyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={12} tickLine={false} />
                    <YAxis fontSize={12} tickLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {functionNames.map((fn) => (
                      <Line
                        key={fn}
                        type="monotone"
                        dataKey={`${fn}_p95`}
                        stroke={FUNCTION_COLORS[fn] || "hsl(var(--primary))"}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Feature Flags Section */}
        <FeatureFlagsSection />
      </main>
    </div>
  );
}

function FeatureFlagsSection() {
  const [targetUserId, setTargetUserId] = useState("");
  const [featureName, setFeatureName] = useState("recurrence");
  const [expiresAt, setExpiresAt] = useState<Date | undefined>();
  const [userFeatures, setUserFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchUserFeatures = async () => {
    if (!targetUserId.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-api", {
        body: { action: "list_user_features", user_id: targetUserId.trim() },
      });
      if (error) throw error;
      setUserFeatures(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const grantFeature = async () => {
    if (!targetUserId.trim() || !featureName.trim()) return;
    try {
      const body: any = { action: "grant_feature", user_id: targetUserId.trim(), feature: featureName.trim() };
      if (expiresAt) body.expires_at = expiresAt.toISOString();
      const { error } = await supabase.functions.invoke("admin-api", { body });
      if (error) throw error;
      toast({ title: "Feature granted" });
      setExpiresAt(undefined);
      fetchUserFeatures();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const revokeFeature = async (feature: string) => {
    try {
      const { error } = await supabase.functions.invoke("admin-api", {
        body: { action: "revoke_feature", user_id: targetUserId.trim(), feature },
      });
      if (error) throw error;
      toast({ title: "Feature revoked" });
      fetchUserFeatures();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Feature Flags</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Manage User Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground">User ID</label>
              <Input
                placeholder="Enter user UUID"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" onClick={fetchUserFeatures} disabled={loading || !targetUserId.trim()}>
              Lookup
            </Button>
          </div>

          {userFeatures.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Active Features</p>
              {userFeatures.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between p-2 rounded-md border border-border bg-muted/30">
                  <div>
                    <span className="font-mono text-sm">{f.feature}</span>
                    {f.expires_at ? (
                      <span className={cn("ml-2 text-xs", isExpired(f.expires_at) ? "text-destructive" : "text-muted-foreground")}>
                        {isExpired(f.expires_at) ? "Expired" : `Expires ${format(new Date(f.expires_at), "MMM d, yyyy")}`}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-muted-foreground">Permanent</span>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => revokeFeature(f.feature)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {targetUserId.trim() && (
            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Grant Feature</p>
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="text-xs text-muted-foreground">Feature name</label>
                  <Input
                    placeholder="recurrence"
                    value={featureName}
                    onChange={(e) => setFeatureName(e.target.value)}
                    className="w-[180px]"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Expires (optional)</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("w-[180px] justify-start text-left font-normal", !expiresAt && "text-muted-foreground")}>
                        <CalendarIcon className="h-4 w-4 mr-1" />
                        {expiresAt ? format(expiresAt, "MMM d, yyyy") : "No expiration"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={expiresAt}
                        onSelect={setExpiresAt}
                        disabled={(date) => date < new Date()}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <Button size="sm" onClick={grantFeature}>
                  <Plus className="h-4 w-4 mr-1" /> Grant
                </Button>
                {expiresAt && (
                  <Button variant="ghost" size="sm" onClick={() => setExpiresAt(undefined)}>
                    Clear date
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
