import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, source, target } = await req.json();

    if (!text || !source || !target) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: text, source, target' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Log the translation request
    console.log('Translation request:', { text, source, target });

    // Try multiple translation services for better reliability
    let translationData;
    let translationError;

    // First try LibreTranslate
    try {
      console.log('Trying LibreTranslate...');
      
      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const translateResponse = await fetch('https://libretranslate.de/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: text,
          source: source,
          target: target,
          format: 'text'
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (translateResponse.ok) {
        translationData = await translateResponse.json();
        console.log('LibreTranslate success:', translationData);
      } else {
        throw new Error(`LibreTranslate returned ${translateResponse.status}`);
      }
    } catch (error) {
      console.log('LibreTranslate failed:', error.message);
      translationError = error;
      
      // Fallback: Try a different LibreTranslate instance
      try {
        console.log('Trying alternate LibreTranslate instance...');
        
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), 8000); // 8 second timeout

        const translateResponse = await fetch('https://translate.argosopentech.com/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            q: text,
            source: source,
            target: target,
            format: 'text'
          }),
          signal: controller2.signal
        });

        clearTimeout(timeoutId2);

        if (translateResponse.ok) {
          translationData = await translateResponse.json();
          console.log('Alternate LibreTranslate success:', translationData);
        } else {
          throw new Error(`Alternate LibreTranslate returned ${translateResponse.status}`);
        }
      } catch (fallbackError) {
        console.log('All translation services failed');
        // Return original text with error indication
        translationData = { 
          translatedText: `[Translation unavailable] ${text}` 
        };
      }
    }
    
    return new Response(
      JSON.stringify({ translatedText: translationData.translatedText }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in translate-message function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});