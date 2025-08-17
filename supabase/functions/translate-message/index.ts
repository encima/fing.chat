import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { text, source, target } = await req.json();
    if (!text || !source || !target) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: text, source, target'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Use LibreTranslate for translation
    const translateResponse = await fetch('http://89.233.107.8:5000/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: text,
        source: source,
        target: target,
        format: 'text'
      })
    });
    console.dir(translateResponse);
    if (!translateResponse.ok) {
      const errorText = await translateResponse.text();
      console.error('LibreTranslate API error:', errorText);
      return new Response(JSON.stringify({
        error: 'Translation failed'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const translationData = await translateResponse.json();
    return new Response(JSON.stringify({
      translatedText: translationData.translatedText
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in translate-message function:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
