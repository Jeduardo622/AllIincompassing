# AllIncompassing - UI Development

## 🎯 bolt.new Integration

This branch is optimized for bolt.new development workflow:

### ✅ What's Included
- React/TypeScript components
- Tailwind CSS styling
- Vite build configuration
- Supabase client integration

### ⚠️ What's Excluded
- Database migrations (maintained locally)
- CI/CD pipeline (GitHub Actions)
- Backend edge functions
- Comprehensive test suite

### 🔄 Development Workflow

1. **Prototype in bolt.new**: Use AI for rapid UI development
2. **Sync to local**: Merge changes back to main codebase
3. **Deploy via CI/CD**: Use existing pipeline for production

### 🛠️ Quick Start

```bash
npm run bolt:dev    # Start development server
npm run bolt:build  # Build for production
```

### 🔗 Integration Points

- **Auth**: Uses existing Supabase authentication
- **Data**: Connects to production Supabase instance
- **Styling**: Tailwind CSS with theme system
- **State**: React Context for auth state management

### 📝 Notes

- This is a UI-focused development environment
- Database schema changes should be made locally
- Security policies and migrations are handled separately
- Full test suite runs in main development environment
