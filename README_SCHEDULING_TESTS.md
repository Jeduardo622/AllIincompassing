# Scheduling Tests Documentation

This document explains the comprehensive test suite for scheduling clients with therapists in the therapy management system.

## Test Structure

### Test Files Created

1. **`src/test/utils.tsx`** - Test utilities and setup
2. **`src/test/setup.ts`** - Global test configuration and mocks
3. **`src/components/__tests__/SchedulingFlow.test.tsx`** - Comprehensive scheduling workflow tests
4. **`src/components/__tests__/SchedulingIntegration.test.tsx`** - End-to-end integration tests

## Test Coverage

### 1. Schedule Page Integration Tests
- **Display of therapists and clients**: Verifies that available therapists and clients are loaded and displayed correctly
- **Existing sessions**: Tests that existing sessions appear on the schedule
- **View switching**: Tests switching between different schedule views (Week, Matrix, etc.)
- **Session filtering**: Tests filtering sessions by therapist and client

### 2. Session Modal Tests  
- **New session creation**: Tests creating new sessions with proper form validation
- **Pre-filled data**: Verifies that selected date/time pre-populates the form
- **Therapist and client selection**: Tests dropdown selection functionality
- **Session editing**: Tests editing existing sessions
- **Error handling**: Tests graceful handling of creation errors

### 3. Availability and Conflict Detection
- **Therapist availability**: Tests that therapists' availability hours are respected
- **Client availability**: Tests that clients' availability hours are respected  
- **Scheduling conflicts**: Tests detection of double-booking scenarios
- **Alternative time suggestions**: Tests suggestion of alternative appointment times
- **Conflict resolution**: Tests the workflow for resolving scheduling conflicts

### 4. Accessibility and UX Tests
- **Keyboard navigation**: Tests that forms can be navigated using keyboard
- **ARIA labels**: Verifies proper accessibility attributes
- **Screen reader compatibility**: Tests that important information is accessible

## Test Data Structure

### Mock Therapists
```typescript
const mockTherapists = [
  {
    id: 'therapist-1',
    full_name: 'Dr. John Smith',
    specialties: ['ABA', 'Behavioral Therapy'],
    availability_hours: {
      monday: { start: '09:00', end: '17:00' },
      // ... other days
    },
    max_clients: 20,
    service_type: ['ABA Therapy'],
    // ... other properties
  }
];
```

### Mock Clients
```typescript
const mockClients = [
  {
    id: 'client-1',
    full_name: 'Alex Thompson',
    date_of_birth: '2015-03-15',
    availability_hours: {
      monday: { start: '10:00', end: '15:00' },
      // ... other days
    },
    service_preference: ['ABA Therapy'],
    // ... other properties
  }
];
```

### Mock Sessions
```typescript
const mockSessions = [
  {
    id: 'session-1',
    client_id: 'client-1',
    therapist_id: 'therapist-1',
    start_time: '2024-03-18T14:00:00Z',
    end_time: '2024-03-18T15:00:00Z',
    status: 'scheduled',
    notes: 'Regular session',
    // ... other properties
  }
];
```

## Running the Tests

### Prerequisites
```bash
npm install
```

### Run All Tests
```bash
npm test
```

### Run Specific Test Files
```bash
# Run comprehensive scheduling flow tests
npm test -- SchedulingFlow.test.tsx

# Run integration tests
npm test -- SchedulingIntegration.test.tsx
```

### Run Tests in Watch Mode
```bash
npm test -- --watch
```

### Generate Coverage Report
```bash
npm test -- --coverage
```

## Test Scenarios Covered

### 1. Happy Path Scenarios
- ✅ Create new session with available therapist and client
- ✅ Edit existing session details
- ✅ Switch between different schedule views
- ✅ Filter sessions by therapist/client

### 2. Edge Cases
- ✅ Attempt to schedule outside availability hours
- ✅ Handle double-booking conflicts
- ✅ Schedule with missing therapist or client data
- ✅ Handle API errors gracefully

### 3. User Experience
- ✅ Pre-populate form with selected time slot
- ✅ Show availability matrix
- ✅ Suggest alternative times for conflicts
- ✅ Provide clear error messages

### 4. Data Validation
- ✅ Validate required fields
- ✅ Check time format constraints (15-minute intervals)
- ✅ Verify session duration limits
- ✅ Validate therapist-client compatibility

## Test Architecture

### Mocking Strategy
- **Supabase Client**: Mocked to return test data
- **API Endpoints**: Mocked using MSW (Mock Service Worker)
- **Date Functions**: Consistent date handling for tests
- **Browser APIs**: Mock for responsive design and virtual scrolling

### Test Organization
- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test component interactions
- **End-to-End Tests**: Test complete user workflows
- **Accessibility Tests**: Test keyboard navigation and screen readers

## Common Test Patterns

### Waiting for Async Operations
```typescript
await waitFor(() => {
  expect(screen.getByText('Dr. John Smith')).toBeInTheDocument();
});
```

### User Interactions
```typescript
const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
await userEvent.selectOptions(therapistSelect, 'therapist-1');
```

### API Mocking
```typescript
server.use(
  http.get('*/rest/v1/therapists*', () => {
    return HttpResponse.json(mockTherapists);
  })
);
```

## Best Practices

1. **Test User Behavior**: Focus on what users actually do, not implementation details
2. **Mock External Dependencies**: Mock API calls and external services
3. **Test Error States**: Ensure graceful error handling
4. **Accessibility First**: Include accessibility tests from the start
5. **Maintainable Tests**: Use descriptive test names and clear assertions

## Debugging Tests

### Common Issues
- **Timing Issues**: Use `waitFor` for async operations
- **Mock Setup**: Ensure mocks are properly configured before tests
- **Data Loading**: Wait for data to load before making assertions
- **Component State**: Consider component lifecycle in tests

### Debug Tips
```typescript
// Add debug output to see what's rendered
screen.debug();

// Log specific elements
console.log(screen.getByRole('button', { name: /submit/i }));
```

## Future Enhancements

1. **Performance Testing**: Add tests for large datasets
2. **Mobile Testing**: Test responsive design behavior
3. **Real-time Updates**: Test WebSocket/real-time functionality
4. **Bulk Operations**: Test scheduling multiple sessions
5. **Calendar Integration**: Test external calendar sync
6. **Notification Tests**: Test appointment reminders

## Contributing

When adding new scheduling features:

1. Write tests first (TDD approach)
2. Include both happy path and edge cases
3. Test accessibility requirements
4. Update this documentation
5. Ensure all tests pass before submitting PR

## Related Documentation

- [Testing Library Documentation](https://testing-library.com/docs/react-testing-library/intro/)
- [Vitest Documentation](https://vitest.dev/)
- [MSW Documentation](https://mswjs.io/)
- [React Hook Form Testing](https://react-hook-form.com/advanced-usage#TestingForm) 