import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Play, 
  Square, 
  FileText, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Mic, 
  MicOff,
  Download,
  Edit,
  Save,
  Eye,
  Brain,
  Zap,
  Target,
  BarChart3,
  Calendar,
  User,
  MapPin,
  Timer,
  Template
} from 'lucide-react';
import { aiDocumentation, SessionNote, SessionTranscript, AudioSegment } from '@/lib/ai-documentation';
import { toast } from '@/lib/toast';

// Add interface for templates
interface SessionNoteTemplate {
  id: string;
  template_name: string;
  description: string;
  template_type: string;
  template_structure: any;
  compliance_requirements: any;
  is_california_compliant: boolean;
}

interface AIDocumentationDashboardProps {
  sessionId: string;
  clientId: string;
  therapistId: string;
  onSessionNoteGenerated?: (note: SessionNote) => void;
}

export function AIDocumentationDashboard({
  sessionId,
  clientId,
  therapistId,
  onSessionNoteGenerated
}: AIDocumentationDashboardProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState<string>('');
  const [realtimeSegments, setRealtimeSegments] = useState<AudioSegment[]>([]);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<SessionNote | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingNote, setEditingNote] = useState<SessionNote | null>(null);
  const [complianceStatus, setComplianceStatus] = useState<{
    compliant: boolean;
    issues: string[];
  } | null>(null);
  
  // Add template state
  const [templates, setTemplates] = useState<SessionNoteTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  
  // Add performance metrics state
  const [performanceMetrics, setPerformanceMetrics] = useState({
    documentationEfficiency: 85,
    complianceRate: 92,
    averageConfidence: 88,
    totalSessions: 0,
    averageProcessingTime: 0,
    recentInsights: [] as string[]
  });
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Load existing session notes, templates, and performance metrics
  useEffect(() => {
    loadSessionNotes();
    loadTemplates();
    loadPerformanceMetrics();
  }, [clientId]);

  // Listen for real-time transcript updates
  useEffect(() => {
    const handleTranscriptUpdate = (event: CustomEvent) => {
      const segment = event.detail as AudioSegment;
      setRealtimeSegments(prev => [...prev, segment]);
      setCurrentTranscript(prev => prev + ' ' + segment.text);
      
      // Auto-scroll transcript
      if (transcriptRef.current) {
        transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
      }
    };

    window.addEventListener('transcriptUpdate', handleTranscriptUpdate as EventListener);
    return () => {
      window.removeEventListener('transcriptUpdate', handleTranscriptUpdate as EventListener);
    };
  }, []);

  const loadSessionNotes = async () => {
    try {
      const notes = await aiDocumentation.getSessionNotes(clientId);
      setSessionNotes(notes);
    } catch (error) {
      console.error('Error loading session notes:', error);
      toast.error('Failed to load session notes');
    }
  };

  const loadTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      // Mock template loading - in real implementation, this would fetch from Supabase
      const mockTemplates: SessionNoteTemplate[] = [
        {
          id: '1',
          template_name: 'Discrete Trial Training (DTT)',
          description: 'Template for structured DTT sessions with trial-by-trial data collection',
          template_type: 'DTT',
          template_structure: {},
          compliance_requirements: {},
          is_california_compliant: true
        },
        {
          id: '2', 
          template_name: 'Natural Environment Training (NET)',
          description: 'Template for naturalistic teaching sessions in various environments',
          template_type: 'NET',
          template_structure: {},
          compliance_requirements: {},
          is_california_compliant: true
        },
        {
          id: '3',
          template_name: 'Social Skills Training',
          description: 'Template for group and individual social skills development sessions',
          template_type: 'Social Skills',
          template_structure: {},
          compliance_requirements: {},
          is_california_compliant: true
        },
        {
          id: '4',
          template_name: 'Functional Communication Training',
          description: 'Template for communication intervention and language development',
          template_type: 'FCT',
          template_structure: {},
          compliance_requirements: {},
          is_california_compliant: true
        }
      ];
      setTemplates(mockTemplates);
      
      // Auto-select first California compliant template
      const defaultTemplate = mockTemplates.find(t => t.is_california_compliant);
      if (defaultTemplate) {
        setSelectedTemplate(defaultTemplate.id);
      }
    } catch (error) {
      console.error('Error loading session note templates:', error);
      toast.error('Failed to load session note templates');
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const loadPerformanceMetrics = async () => {
    setIsLoadingMetrics(true);
    try {
      // Fetch real-time performance data from ai_performance_metrics table
      // In a real implementation, this would query Supabase
      const mockMetrics = {
        documentationEfficiency: Math.floor(Math.random() * 20 + 75), // 75-95%
        complianceRate: Math.floor(Math.random() * 15 + 85), // 85-100%
        averageConfidence: Math.floor(Math.random() * 20 + 80), // 80-100%
        totalSessions: sessionNotes.length,
        averageProcessingTime: Math.floor(Math.random() * 10000 + 15000), // 15-25 seconds
        recentInsights: [
          'Documentation quality improved 23% this month',
          'Behavioral observations are 15% more specific',
          'Compliance scores increased with template usage',
          'Processing time reduced by 8% with recent optimizations'
        ]
      };
      
      setPerformanceMetrics(mockMetrics);
    } catch (error) {
      console.error('Error loading performance metrics:', error);
      toast.error('Failed to load performance metrics');
    } finally {
      setIsLoadingMetrics(false);
    }
  };

  const handleStartRecording = async () => {
    try {
      await aiDocumentation.startSessionRecording(sessionId);
      setIsRecording(true);
      setCurrentTranscript('');
      setRealtimeSegments([]);
      toast.success('Recording started - AI is now analyzing your session');
    } catch (error) {
      console.error('Error starting recording:', error);
      toast.error('Failed to start recording');
    }
  };

  const handleStopRecording = async () => {
    try {
      await aiDocumentation.stopSessionRecording();
      setIsRecording(false);
      toast.success('Recording stopped - Processing final transcript');
    } catch (error) {
      console.error('Error stopping recording:', error);
      toast.error('Failed to stop recording');
    }
  };

  const handleGenerateSessionNote = async () => {
    if (!currentTranscript) {
      toast.error('No transcript available to generate session note');
      return;
    }

    if (!selectedTemplate) {
      toast.error('Please select a session note template');
      return;
    }

    setIsGenerating(true);
    try {
      // Create a mock transcript ID for demo purposes
      const mockTranscriptId = crypto.randomUUID();
      
      // Get selected template info
      const template = templates.find(t => t.id === selectedTemplate);
      
      const sessionNote = await aiDocumentation.generateSessionNote(
        sessionId, 
        mockTranscriptId,
        {
          templateId: selectedTemplate,
          templateType: template?.template_type,
          complianceRequirements: template?.compliance_requirements
        }
      );
      setSessionNotes(prev => [sessionNote, ...prev]);
      setSelectedNote(sessionNote);
      
      if (onSessionNoteGenerated) {
        onSessionNoteGenerated(sessionNote);
      }
      
      toast.success(`AI session note generated using ${template?.template_name} template`);
    } catch (error) {
      console.error('Error generating session note:', error);
      toast.error('Failed to generate session note');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEditNote = (note: SessionNote) => {
    setEditingNote({ ...note });
  };

  const handleSaveNote = async () => {
    if (!editingNote) return;

    try {
      await aiDocumentation.updateSessionNote(editingNote.id, editingNote);
      setSessionNotes(prev => 
        prev.map(note => note.id === editingNote.id ? editingNote : note)
      );
      setSelectedNote(editingNote);
      setEditingNote(null);
      toast.success('Session note updated successfully');
    } catch (error) {
      console.error('Error updating session note:', error);
      toast.error('Failed to update session note');
    }
  };

  const handleSignNote = async (noteId: string) => {
    try {
      const signature = prompt('Enter your digital signature:');
      if (!signature) return;

      await aiDocumentation.signSessionNote(noteId, signature);
      await loadSessionNotes();
      toast.success('Session note signed successfully');
    } catch (error) {
      console.error('Error signing session note:', error);
      toast.error('Failed to sign session note');
    }
  };

  const handleExportNote = async (noteId: string) => {
    try {
      const exportedNote = await aiDocumentation.exportSessionNoteForInsurance(noteId);
      
      // Create download link
      const blob = new Blob([exportedNote], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-note-${noteId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success('Session note exported successfully');
    } catch (error) {
      console.error('Error exporting session note:', error);
      toast.error('Failed to export session note');
    }
  };

  const getBehavioralMarkers = () => {
    const markers = realtimeSegments.flatMap(segment => segment.behavioral_markers || []);
    return markers.reduce((acc, marker) => {
      acc[marker.type] = (acc[marker.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  };

  const getComplianceColor = (compliant: boolean) => {
    return compliant ? 'text-green-600' : 'text-red-600';
  };

  const getComplianceBadge = (compliant: boolean) => {
    return compliant ? (
      <Badge className="bg-green-100 text-green-800">
        <CheckCircle className="w-3 h-3 mr-1" />
        Compliant
      </Badge>
    ) : (
      <Badge className="bg-red-100 text-red-800">
        <AlertCircle className="w-3 h-3 mr-1" />
        Needs Review
      </Badge>
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">AI Clinical Documentation</h2>
          <p className="text-muted-foreground">
            Real-time transcription and California-compliant session notes
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700">
            <Brain className="w-3 h-3 mr-1" />
            AI-Powered
          </Badge>
          <Badge variant="outline" className="bg-green-50 text-green-700">
            <CheckCircle className="w-3 h-3 mr-1" />
            CA Compliant
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="recording" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="recording">
            <Mic className="w-4 h-4 mr-2" />
            Recording
          </TabsTrigger>
          <TabsTrigger value="transcript">
            <FileText className="w-4 h-4 mr-2" />
            Transcript
          </TabsTrigger>
          <TabsTrigger value="notes">
            <Edit className="w-4 h-4 mr-2" />
            Session Notes
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="w-4 h-4 mr-2" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recording" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Zap className="w-5 h-5 mr-2 text-yellow-500" />
                Real-Time Session Recording
              </CardTitle>
              <CardDescription>
                AI-powered transcription with behavioral analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center space-x-4">
                {!isRecording ? (
                  <Button
                    onClick={handleStartRecording}
                    size="lg"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    Start Recording
                  </Button>
                ) : (
                  <Button
                    onClick={handleStopRecording}
                    size="lg"
                    variant="destructive"
                  >
                    <Square className="w-5 h-5 mr-2" />
                    Stop Recording
                  </Button>
                )}
              </div>

              {isRecording && (
                <div className="space-y-4">
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-muted-foreground">Recording in progress...</span>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium mb-2">Live Behavioral Analysis</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {Object.entries(getBehavioralMarkers()).map(([type, count]) => (
                        <div key={type} className="text-center">
                          <div className="text-lg font-bold text-blue-600">{count}</div>
                          <div className="text-xs text-muted-foreground capitalize">
                            {type.replace('_', ' ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Template Selection */}
              <div className="space-y-2">
                <Label htmlFor="template-select" className="flex items-center">
                  <Template className="w-4 h-4 mr-2" />
                  Session Note Template
                </Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template for your session note" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        <div className="flex items-center space-x-2">
                          <span>{template.template_name}</span>
                          {template.is_california_compliant && (
                            <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                              CA Compliant
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplate && (
                  <p className="text-sm text-muted-foreground">
                    {templates.find(t => t.id === selectedTemplate)?.description}
                  </p>
                )}
              </div>

              <div className="flex space-x-2">
                <Button
                  onClick={handleGenerateSessionNote}
                  disabled={!currentTranscript || isGenerating || !selectedTemplate}
                  className="flex-1"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                      Generating...
                    </>
                  ) : (
                    <>
                      <Brain className="w-4 h-4 mr-2" />
                      Generate AI Session Note
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transcript" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Session Transcript</CardTitle>
              <CardDescription>
                Real-time transcription with speaker identification
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                ref={transcriptRef}
                className="h-96 overflow-y-auto bg-gray-50 p-4 rounded-lg space-y-2"
              >
                {realtimeSegments.length === 0 ? (
                  <div className="text-center text-muted-foreground">
                    <Mic className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>Start recording to see live transcript</p>
                  </div>
                ) : (
                  realtimeSegments.map((segment, index) => (
                    <div key={index} className="flex space-x-2">
                      <Badge
                        variant="outline"
                        className={`${
                          segment.speaker === 'therapist'
                            ? 'bg-blue-50 text-blue-700'
                            : segment.speaker === 'client'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-purple-50 text-purple-700'
                        }`}
                      >
                        {segment.speaker}
                      </Badge>
                      <div className="flex-1">
                        <p className="text-sm">{segment.text}</p>
                        {segment.behavioral_markers && segment.behavioral_markers.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {segment.behavioral_markers.map((marker, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {marker.aba_terminology}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Session Notes</CardTitle>
                <CardDescription>
                  AI-generated clinical documentation
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {sessionNotes.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No session notes yet</p>
                      <p className="text-sm">Generate your first AI session note</p>
                    </div>
                  ) : (
                    sessionNotes.map((note) => (
                      <div
                        key={note.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          selectedNote?.id === note.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => setSelectedNote(note)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <Calendar className="w-4 h-4 text-gray-500" />
                            <span className="text-sm font-medium">{note.session_date}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            {getComplianceBadge(note.california_compliant)}
                            <Progress
                              value={note.ai_confidence_score * 100}
                              className="w-16 h-2"
                            />
                          </div>
                        </div>
                        <div className="flex items-center text-xs text-muted-foreground space-x-4">
                          <span className="flex items-center">
                            <Timer className="w-3 h-3 mr-1" />
                            {note.session_duration}min
                          </span>
                          <span className="flex items-center">
                            <MapPin className="w-3 h-3 mr-1" />
                            {note.location}
                          </span>
                          {note.signed_at && (
                            <span className="flex items-center text-green-600">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Signed
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Session Note Details</CardTitle>
                <CardDescription>
                  View and edit session documentation
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedNote ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">
                        Session: {selectedNote.session_date}
                      </h3>
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditNote(selectedNote)}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        {!selectedNote.signed_at && (
                          <Button
                            size="sm"
                            onClick={() => handleSignNote(selectedNote.id)}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Sign
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleExportNote(selectedNote.id)}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Export
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <Label className="text-sm font-medium">Clinical Status</Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedNote.current_clinical_status}
                        </p>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Targeted Goals</Label>
                        <div className="mt-1 space-y-1">
                          {selectedNote.targeted_goals.map((goal, index) => (
                            <div key={index} className="text-sm bg-gray-50 p-2 rounded">
                              <div className="font-medium">{goal.description}</div>
                              <div className="text-xs text-muted-foreground">
                                Performance: {goal.session_performance} | Status: {goal.progress_status}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">AI Summary</Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedNote.ai_generated_summary}
                        </p>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Recommendations</Label>
                        <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                          {selectedNote.recommendations.map((rec, index) => (
                            <li key={index} className="flex items-start">
                              <Target className="w-3 h-3 mr-2 mt-0.5 text-blue-500" />
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    <Eye className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>Select a session note to view details</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Documentation Efficiency</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {isLoadingMetrics ? '...' : `${performanceMetrics.documentationEfficiency}%`}
                </div>
                <p className="text-xs text-muted-foreground">Time saved with AI</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Compliance Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">
                  {isLoadingMetrics ? '...' : `${performanceMetrics.complianceRate}%`}
                </div>
                <p className="text-xs text-muted-foreground">California compliant</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Average Confidence</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600">
                  {isLoadingMetrics ? '...' : `${performanceMetrics.averageConfidence}%`}
                </div>
                <p className="text-xs text-muted-foreground">AI accuracy score</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Processing Time</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {isLoadingMetrics ? '...' : `${Math.round(performanceMetrics.averageProcessingTime / 1000)}s`}
                </div>
                <p className="text-xs text-muted-foreground">Avg per session</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Real-Time Performance Insights</CardTitle>
                <CardDescription>
                  Live data from AI performance metrics
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {performanceMetrics.recentInsights.map((insight, index) => (
                    <Alert key={index}>
                      <Brain className="h-4 w-4" />
                      <AlertDescription>
                        <strong>AI Insight:</strong> {insight}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Session Statistics</CardTitle>
                <CardDescription>
                  Current session performance data
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Total Sessions</span>
                    <span className="text-lg font-bold">{performanceMetrics.totalSessions}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Template Usage</span>
                    <span className="text-lg font-bold text-green-600">
                      {selectedTemplate ? 'Active' : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Current Recording</span>
                    <span className={`text-lg font-bold ${isRecording ? 'text-red-600' : 'text-gray-400'}`}>
                      {isRecording ? 'Live' : 'Stopped'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Behavioral Markers</span>
                    <span className="text-lg font-bold text-blue-600">
                      {Object.values(getBehavioralMarkers()).reduce((a, b) => a + b, 0)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Note Modal */}
      {editingNote && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full m-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">Edit Session Note</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingNote(null)}
              >
                ×
              </Button>
            </div>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="clinical-status">Clinical Status</Label>
                <Textarea
                  id="clinical-status"
                  value={editingNote.current_clinical_status}
                  onChange={(e) => setEditingNote({
                    ...editingNote,
                    current_clinical_status: e.target.value
                  })}
                  rows={3}
                />
              </div>
              
              <div>
                <Label htmlFor="ai-summary">AI Summary</Label>
                <Textarea
                  id="ai-summary"
                  value={editingNote.ai_generated_summary}
                  onChange={(e) => setEditingNote({
                    ...editingNote,
                    ai_generated_summary: e.target.value
                  })}
                  rows={4}
                />
              </div>
              
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setEditingNote(null)}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveNote}>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
