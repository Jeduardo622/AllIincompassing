-- Check if the functions from our target migrations exist
SELECT 
    routine_name,
    routine_type,
    routine_definition
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
    'get_recent_chat_history',
    'generate_semantic_cache_key', 
    'get_cached_ai_response',
    'cache_ai_response'
)
ORDER BY routine_name;

-- Also check for any cache-related functions
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name LIKE '%cache%'
ORDER BY routine_name; 