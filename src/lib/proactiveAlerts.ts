import { supabase } from './supabase';

export interface AlertThreshold {
  metric_name: string;
  warning_threshold: number;
  critical_threshold: number;
  check_interval_seconds: number;
  enabled: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  metric_type: 'ai_performance' | 'db_performance' | 'system_performance';
  thresholds: AlertThreshold;
  notification_channels: Array<'email' | 'browser' | 'slack'>;
  created_at: string;
  updated_at: string;
}

export interface PerformanceAlert {
  id: string;
  alert_type: string;
  metric_name: string;
  current_value: number;
  threshold_value: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  resolved: boolean;
  created_at: string;
  resolved_at?: string;
  auto_generated: boolean;
}

class ProactiveAlertSystem {
  private monitoringIntervals = new Map<string, NodeJS.Timeout>();
  private isInitialized = false;
  
  // Default alert rules
  private defaultRules: Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>[] = [
    {
      name: 'AI Response Time Alert',
      description: 'Monitor AI response times for performance degradation',
      metric_type: 'ai_performance',
      thresholds: {
        metric_name: 'response_time_ms',
        warning_threshold: 750,
        critical_threshold: 1500,
        check_interval_seconds: 60,
        enabled: true
      },
      notification_channels: ['browser', 'email']
    },
    {
      name: 'Database Query Performance Alert',
      description: 'Monitor database query execution times',
      metric_type: 'db_performance',
      thresholds: {
        metric_name: 'execution_time_ms',
        warning_threshold: 1000,
        critical_threshold: 3000,
        check_interval_seconds: 120,
        enabled: true
      },
      notification_channels: ['browser', 'email']
    },
    {
      name: 'Cache Hit Rate Alert',
      description: 'Monitor cache performance and hit rates',
      metric_type: 'ai_performance',
      thresholds: {
        metric_name: 'cache_hit_rate',
        warning_threshold: 70,
        critical_threshold: 50,
        check_interval_seconds: 300,
        enabled: true
      },
      notification_channels: ['browser']
    },
    {
      name: 'System Memory Usage Alert',
      description: 'Monitor system memory usage',
      metric_type: 'system_performance',
      thresholds: {
        metric_name: 'memory_usage_percent',
        warning_threshold: 80,
        critical_threshold: 90,
        check_interval_seconds: 180,
        enabled: true
      },
      notification_channels: ['browser', 'email']
    },
    {
      name: 'Slow Query Detection',
      description: 'Detect and alert on slow database queries',
      metric_type: 'db_performance',
      thresholds: {
        metric_name: 'slow_query_count',
        warning_threshold: 5,
        critical_threshold: 10,
        check_interval_seconds: 300,
        enabled: true
      },
      notification_channels: ['browser', 'email']
    }
  ];

  async initialize() {
    if (this.isInitialized) return;
    
    console.log('Initializing Proactive Alert System...');
    
    try {
      // Ensure default alert rules exist
      await this.ensureDefaultRules();
      
      // Load and start monitoring for all enabled rules
      const rules = await this.getActiveRules();
      
      for (const rule of rules) {
        if (rule.thresholds.enabled) {
          this.startMonitoring(rule);
        }
      }
      
      this.isInitialized = true;
      console.log(`Proactive Alert System initialized with ${rules.length} active rules`);
      
    } catch (error) {
      console.error('Failed to initialize Proactive Alert System:', error);
    }
  }

  private async ensureDefaultRules() {
    try {
      // Check if rules table exists and has data
      const { data: existingRules, error } = await supabase
        .from('alert_rules')
        .select('name')
        .limit(1);

      if (error) {
        console.log('Alert rules table not found, creating default rules in memory');
        return;
      }

      // If no rules exist, create default ones
      if (!existingRules || existingRules.length === 0) {
        console.log('Creating default alert rules...');
        
        for (const rule of this.defaultRules) {
          const { error: insertError } = await supabase
            .from('alert_rules')
            .insert({
              ...rule,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });

          if (insertError) {
            console.warn('Failed to create default rule:', rule.name, insertError);
          }
        }
      }
    } catch (error) {
      console.warn('Could not ensure default rules:', error);
    }
  }

  private async getActiveRules(): Promise<AlertRule[]> {
    try {
      const { data: rules, error } = await supabase
        .from('alert_rules')
        .select('*')
        .eq('thresholds->enabled', true);

      if (error) {
        console.warn('Could not load alert rules from database, using defaults');
        return this.defaultRules.map((rule, index) => ({
          ...rule,
          id: `default-${index}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
      }

      return rules || [];
    } catch (error) {
      console.warn('Error loading alert rules:', error);
      return [];
    }
  }

  private startMonitoring(rule: AlertRule) {
    const intervalId = setInterval(
      () => this.checkMetrics(rule),
      rule.thresholds.check_interval_seconds * 1000
    );
    
    this.monitoringIntervals.set(rule.id, intervalId);
    console.log(`Started monitoring: ${rule.name} (${rule.thresholds.check_interval_seconds}s intervals)`);
  }

  private async checkMetrics(rule: AlertRule) {
    try {
      const currentValue = await this.getCurrentMetricValue(rule);
      
      if (currentValue === null) return;
      
      const severity = this.evaluateThreshold(currentValue, rule.thresholds);
      
      if (severity) {
        await this.createAlert(rule, currentValue, severity);
      }
      
    } catch (error) {
      console.error(`Error checking metrics for rule ${rule.name}:`, error);
    }
  }

  private async getCurrentMetricValue(rule: AlertRule): Promise<number | null> {
    try {
      const tableName = this.getMetricTableName(rule.metric_type);
      const metricField = this.getMetricFieldName(rule.thresholds.metric_name);
      
      // For special metrics like cache hit rate, calculate it
      if (rule.thresholds.metric_name === 'cache_hit_rate') {
        return await this.calculateCacheHitRate();
      }
      
      if (rule.thresholds.metric_name === 'slow_query_count') {
        return await this.countSlowQueries();
      }
      
      // Get recent metric value (last 5 minutes)
      const { data, error } = await supabase
        .from(tableName)
        .select(metricField)
        .gte('timestamp', new Date(Date.now() - 5 * 60 * 1000).toISOString())
        .order('timestamp', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) return null;
      
      return data[0][metricField] || null;
    } catch (error) {
      console.error('Error getting current metric value:', error);
      return null;
    }
  }

  private async calculateCacheHitRate(): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from('ai_performance_metrics')
        .select('cache_hit')
        .gte('timestamp', new Date(Date.now() - 10 * 60 * 1000).toISOString());

      if (error || !data || data.length === 0) return null;
      
      const hits = data.filter(d => d.cache_hit).length;
      return (hits / data.length) * 100;
    } catch (error) {
      console.error('Error calculating cache hit rate:', error);
      return null;
    }
  }

  private async countSlowQueries(): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from('db_performance_metrics')
        .select('id')
        .eq('slow_query', true)
        .gte('timestamp', new Date(Date.now() - 10 * 60 * 1000).toISOString());

      if (error) return null;
      
      return data?.length || 0;
    } catch (error) {
      console.error('Error counting slow queries:', error);
      return null;
    }
  }

  private getMetricTableName(metricType: AlertRule['metric_type']): string {
    switch (metricType) {
      case 'ai_performance': return 'ai_performance_metrics';
      case 'db_performance': return 'db_performance_metrics';
      case 'system_performance': return 'system_performance_metrics';
      default: return 'ai_performance_metrics';
    }
  }

  private getMetricFieldName(metricName: string): string {
    switch (metricName) {
      case 'response_time_ms': return 'response_time_ms';
      case 'execution_time_ms': return 'execution_time_ms';
      case 'memory_usage_percent': return 'value';
      default: return 'value';
    }
  }

  private evaluateThreshold(value: number, thresholds: AlertThreshold): 'critical' | 'high' | 'medium' | null {
    if (value >= thresholds.critical_threshold) {
      return 'critical';
    }
    
    if (value >= thresholds.warning_threshold) {
      return 'high';
    }
    
    return null;
  }

  private async createAlert(rule: AlertRule, currentValue: number, severity: 'critical' | 'high' | 'medium') {
    try {
      const threshold = severity === 'critical' ? rule.thresholds.critical_threshold : rule.thresholds.warning_threshold;
      
      // Check if similar alert exists and is unresolved
      const { data: existingAlert } = await supabase
        .from('performance_alerts')
        .select('id')
        .eq('metric_name', rule.thresholds.metric_name)
        .eq('resolved', false)
        .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // Last 30 minutes
        .limit(1);

      if (existingAlert && existingAlert.length > 0) {
        console.log(`Skipping duplicate alert for ${rule.name}`);
        return;
      }

      const alert: Omit<PerformanceAlert, 'id'> = {
        alert_type: rule.name,
        metric_name: rule.thresholds.metric_name,
        current_value: currentValue,
        threshold_value: threshold,
        severity,
        message: this.generateAlertMessage(rule, currentValue, threshold, severity),
        resolved: false,
        created_at: new Date().toISOString(),
        auto_generated: true
      };

      const { error } = await supabase
        .from('performance_alerts')
        .insert(alert);

      if (error) {
        console.error('Failed to create alert:', error);
        return;
      }

      console.log(`Created ${severity} alert: ${rule.name} (${currentValue} > ${threshold})`);
      
      // Send notifications
      await this.sendNotifications(alert, rule.notification_channels);
      
    } catch (error) {
      console.error('Error creating alert:', error);
    }
  }

  private generateAlertMessage(rule: AlertRule, currentValue: number, threshold: number, severity: string): string {
    const formatValue = (value: number) => {
      if (rule.thresholds.metric_name.includes('time')) {
        return `${Math.round(value)}ms`;
      }
      if (rule.thresholds.metric_name.includes('percent') || rule.thresholds.metric_name.includes('rate')) {
        return `${Math.round(value)}%`;
      }
      return Math.round(value).toString();
    };

    return `${severity.toUpperCase()}: ${rule.name} - ${rule.thresholds.metric_name} is ${formatValue(currentValue)}, exceeding ${severity} threshold of ${formatValue(threshold)}`;
  }

  private async sendNotifications(alert: Omit<PerformanceAlert, 'id'>, channels: Array<'email' | 'browser' | 'slack'>) {
    for (const channel of channels) {
      try {
        switch (channel) {
          case 'browser':
            this.sendBrowserNotification(alert);
            break;
          case 'email':
            // Implement email notifications
            console.log('Email notification would be sent:', alert.message);
            break;
          case 'slack':
            // Implement Slack notifications
            console.log('Slack notification would be sent:', alert.message);
            break;
        }
      } catch (error) {
        console.error(`Failed to send ${channel} notification:`, error);
      }
    }
  }

  private sendBrowserNotification(alert: Omit<PerformanceAlert, 'id'>) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`Performance Alert: ${alert.alert_type}`, {
        body: alert.message,
        icon: '/favicon.ico',
        tag: `alert-${alert.metric_name}`,
        requireInteraction: alert.severity === 'critical'
      });
    }
  }

  async addRule(rule: Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>) {
    try {
      const { data, error } = await supabase
        .from('alert_rules')
        .insert({
          ...rule,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      if (rule.thresholds.enabled) {
        this.startMonitoring(data);
      }

      return data;
    } catch (error) {
      console.error('Error adding alert rule:', error);
      throw error;
    }
  }

  async updateRule(id: string, updates: Partial<AlertRule>) {
    try {
      const { data, error } = await supabase
        .from('alert_rules')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Restart monitoring if rule was updated
      this.stopMonitoring(id);
      if (data.thresholds.enabled) {
        this.startMonitoring(data);
      }

      return data;
    } catch (error) {
      console.error('Error updating alert rule:', error);
      throw error;
    }
  }

  private stopMonitoring(ruleId: string) {
    const intervalId = this.monitoringIntervals.get(ruleId);
    if (intervalId) {
      clearInterval(intervalId);
      this.monitoringIntervals.delete(ruleId);
      console.log(`Stopped monitoring for rule: ${ruleId}`);
    }
  }

  async resolveAlert(alertId: string) {
    try {
      const { error } = await supabase
        .from('performance_alerts')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString()
        })
        .eq('id', alertId);

      if (error) throw error;
      
      console.log(`Resolved alert: ${alertId}`);
    } catch (error) {
      console.error('Error resolving alert:', error);
      throw error;
    }
  }

  shutdown() {
    console.log('Shutting down Proactive Alert System...');
    
    // Clear all monitoring intervals
    for (const [ruleId, intervalId] of this.monitoringIntervals) {
      clearInterval(intervalId);
      console.log(`Stopped monitoring: ${ruleId}`);
    }
    
    this.monitoringIntervals.clear();
    this.isInitialized = false;
  }
}

// Singleton instance
export const proactiveAlertSystem = new ProactiveAlertSystem();

// Auto-initialize when module loads (only in browser)
if (typeof window !== 'undefined') {
  // Request notification permissions
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  
  // Initialize the alert system
  proactiveAlertSystem.initialize();
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    proactiveAlertSystem.shutdown();
  });
} 